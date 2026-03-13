'use node';

import { updateThreadMetadata } from '@convex-dev/agent';
import { generateText } from 'ai';
import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction, type ActionCtx } from './_generated/server';
import { abortRunWithReason } from './agentChatActions';
import {
  getChatLanguageModel,
  type ChatThreadDoc,
} from './lib/agentChat';
import { DEFAULT_CHAT_MODEL_ID } from '../src/lib/shared/chat-models';

const STALE_STREAM_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_STALE_CLEANUP_LIMIT = 20;

function getMessageText(message: {
  message?: {
    role?: string;
    content?: unknown;
  };
}) {
  const content = message.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
}

async function buildRecentTranscript(ctx: ActionCtx, agentThreadId: string) {
  const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: agentThreadId,
    order: 'desc',
    paginationOpts: { cursor: null, numItems: 8 },
    excludeToolMessages: true,
  });

  return [...messages.page]
    .reverse()
    .filter((message) => message.message?.role === 'assistant' || message.message?.role === 'user')
    .map((message) => {
      const role = message.message?.role;
      if (!role) {
        return '';
      }

      const content = getMessageText(message).trim();
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function getStaleStreamPartialText(
  ctx: ActionCtx,
  run: Doc<'chatRuns'>,
) {
  if (!run.agentStreamId) {
    return '';
  }

  return (
    await ctx.runQuery(components.agent.streams.listDeltas, {
      threadId: run.agentThreadId,
      cursors: [{ streamId: run.agentStreamId, cursor: 0 }],
    })
  )
    .flatMap((delta) => delta.parts)
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      'type' in part &&
      part.type === 'text-delta' &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : part &&
            typeof part === 'object' &&
            'type' in part &&
            part.type === 'text-delta' &&
            'delta' in part &&
            typeof part.delta === 'string'
          ? [part.delta]
        : [],
    )
    .join('')
    .trim();
}

export const runPostCompletionJobs = internalAction({
  args: {
    runId: v.id('chatRuns'),
  },
  handler: async (ctx, args) => {
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
      runId: args.runId,
    })) as Doc<'chatRuns'> | null;

    if (!run) {
      return;
    }

    const thread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
      threadId: run.threadId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      return;
    }

    const transcript = await buildRecentTranscript(ctx, run.agentThreadId);
    if (!transcript) {
      return;
    }

    const model = getChatLanguageModel(DEFAULT_CHAT_MODEL_ID, false);

    if (!thread.titleManuallyEdited) {
      const titleResult = await generateText({
        model,
        prompt: `Write a concise title under 60 characters for this chat.\n\n${transcript}`,
      });
      const title = titleResult.text.trim().replace(/^["']|["']$/g, '').slice(0, 60);
      if (title) {
        const latestThread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
          threadId: run.threadId,
        })) as ChatThreadDoc | null;
        if (latestThread && !latestThread.titleManuallyEdited) {
          await ctx.runMutation(internal.agentChat.patchThreadInternal, {
            threadId: run.threadId,
            patch: {
              title,
              updatedAt: Date.now(),
            },
          });
          await updateThreadMetadata(ctx, components.agent, {
            threadId: run.agentThreadId,
            patch: {
              title,
            },
          });
        }
      }
    }

    const summaryResult = await generateText({
      model,
      prompt: `Summarize this chat in 2 sentences for internal retrieval context.\n\n${transcript}`,
    });
    const summary = summaryResult.text.trim().slice(0, 500);
    if (!summary) {
      return;
    }

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: run.threadId,
      patch: {
        summary,
        summaryUpdatedAt: Date.now(),
      },
    });
    await updateThreadMetadata(ctx, components.agent, {
      threadId: run.agentThreadId,
      patch: {
        summary,
      },
    });
  },
});

export const cleanupStaleChatRuns = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const staleRuns = (await ctx.runQuery(internal.agentChat.listStaleStreamingRunsInternal, {
      startedBefore: Date.now() - STALE_STREAM_TIMEOUT_MS,
      limit: args.limit ?? DEFAULT_STALE_CLEANUP_LIMIT,
    })) as Doc<'chatRuns'>[];

    for (const run of staleRuns) {
      const currentRun = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
        runId: run._id,
      })) as Doc<'chatRuns'> | null;

      if (!currentRun || currentRun.status !== 'streaming') {
        continue;
      }

      const thread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
        threadId: currentRun.threadId,
      })) as ChatThreadDoc | null;
      const partialText = await getStaleStreamPartialText(ctx, currentRun);

      await abortRunWithReason(ctx, {
        run: currentRun,
        reason: 'Stream expired before completion.',
        status: 'error',
        partialText,
      });

      if (thread) {
        await ctx.runMutation(internal.agentChat.patchThreadInternal, {
          threadId: thread._id,
          patch: {
            updatedAt: Date.now(),
            lastMessageAt: Date.now(),
          },
        });
      }
    }
  },
});
