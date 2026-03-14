'use node';

import { updateThreadMetadata } from '@convex-dev/agent';
import { v } from 'convex/values';
import { DEFAULT_CHAT_MODEL_ID } from '../src/lib/shared/chat-models';
import { components, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { type ActionCtx, internalAction } from './_generated/server';
import { abortRunWithReason } from './agentChatActions';
import {
  type ChatThreadDoc,
  getChatLanguageModel,
  getOpenRouterProviderOptions,
} from './lib/agentChat';
import { successTrueValidator } from './lib/returnValidators';
import { trackedGenerateText } from './lib/chatAgentRuntime';

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

async function buildRecentTranscript(ctx: ActionCtx, agentThreadId: string, limit = 12) {
  const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId: agentThreadId,
    order: 'desc',
    paginationOpts: { cursor: null, numItems: limit },
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

type ThreadTranscriptMessage = {
  order: number;
  stepOrder: number;
  message?: {
    role?: string;
    content?: unknown;
  };
};

async function buildTranscriptDeltaSinceOrder(
  ctx: ActionCtx,
  agentThreadId: string,
  afterOrder: number | undefined,
) {
  let cursor: string | null = null;
  const unsummarizedMessages: ThreadTranscriptMessage[] = [];

  while (true) {
    const page = (await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: agentThreadId,
      order: 'desc',
      paginationOpts: { cursor, numItems: 50 },
      excludeToolMessages: true,
    })) as {
      page: ThreadTranscriptMessage[];
      isDone: boolean;
      continueCursor: string | null;
    };

    for (const message of page.page) {
      if (
        (message.message?.role === 'assistant' || message.message?.role === 'user') &&
        (afterOrder === undefined || message.order > afterOrder)
      ) {
        unsummarizedMessages.push(message);
      }
    }

    const oldestOrderInPage = page.page[page.page.length - 1]?.order;
    if (page.isDone || !page.continueCursor) {
      break;
    }
    if (
      afterOrder !== undefined &&
      oldestOrderInPage !== undefined &&
      oldestOrderInPage <= afterOrder
    ) {
      break;
    }

    cursor = page.continueCursor;
  }

  const sortedMessages = [...unsummarizedMessages].sort((left, right) => {
    if (left.order === right.order) {
      return left.stepOrder - right.stepOrder;
    }

    return left.order - right.order;
  });
  const transcript = sortedMessages
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

  return {
    transcript,
    latestOrder: sortedMessages[sortedMessages.length - 1]?.order,
  };
}

async function getStaleStreamPartialText(ctx: ActionCtx, run: Doc<'chatRuns'>) {
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
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    const run = (await ctx.runQuery(internal.agentChat.getRunByIdAnyInternal, {
      runId: args.runId,
    })) as Doc<'chatRuns'> | null;

    if (!run) {
      return { success: true };
    }

    const thread = (await ctx.runQuery(internal.agentChat.getThreadByIdInternal, {
      threadId: run.threadId,
    })) as ChatThreadDoc | null;
    if (!thread) {
      return { success: true };
    }

    const transcript = await buildRecentTranscript(ctx, run.agentThreadId);
    if (!transcript) {
      return { success: true };
    }

    const modelId = DEFAULT_CHAT_MODEL_ID;
    const model = getChatLanguageModel(modelId, false);

    if (!thread.titleManuallyEdited) {
      const titleResult = await trackedGenerateText(ctx, {
        thread,
        actorUserId: run.initiatedByUserId,
        runId: run._id,
        operationKind: 'thread_title',
        model,
        modelId,
        providerOptions: getOpenRouterProviderOptions({
          modelId,
          useWebSearch: false,
        }),
        prompt: `Write a concise title under 60 characters for this chat.\n\n${transcript}`,
      });
      const title = titleResult.text
        .trim()
        .replace(/^["']|["']$/g, '')
        .slice(0, 60);
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

    const priorSummary = thread.summary?.trim();
    const { transcript: transcriptDelta, latestOrder } = await buildTranscriptDeltaSinceOrder(
      ctx,
      run.agentThreadId,
      thread.summaryThroughOrder,
    );
    if (!transcriptDelta || latestOrder === undefined) {
      return { success: true };
    }
    const summaryPrompt = priorSummary
      ? `Update the existing internal chat summary using the new transcript delta. Keep the result under 500 characters and focus on durable facts, goals, and decisions.

Existing summary:
${priorSummary}

Recent transcript delta:
${transcriptDelta}`
      : `Summarize this chat in 2 sentences for internal retrieval context. Keep the result under 500 characters and focus on durable facts, goals, and decisions.

${transcriptDelta}`;
    const summaryResult = await trackedGenerateText(ctx, {
      thread,
      actorUserId: run.initiatedByUserId,
      runId: run._id,
      operationKind: 'thread_summary',
      model,
      modelId,
      providerOptions: getOpenRouterProviderOptions({
        modelId,
        useWebSearch: false,
      }),
      prompt: summaryPrompt,
    });
    const summary = summaryResult.text.trim().slice(0, 500);
    if (!summary) {
      return { success: true };
    }

    await ctx.runMutation(internal.agentChat.patchThreadInternal, {
      threadId: run.threadId,
      patch: {
        summary,
        summaryUpdatedAt: Date.now(),
        summaryThroughOrder: latestOrder,
      },
    });
    await updateThreadMetadata(ctx, components.agent, {
      threadId: run.agentThreadId,
      patch: {
        summary,
      },
    });

    return { success: true };
  },
});

export const cleanupStaleChatRuns = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  returns: successTrueValidator,
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

    return { success: true };
  },
});
