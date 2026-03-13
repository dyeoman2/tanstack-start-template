'use node';

import { Agent, createTool, getThreadMetadata } from '@convex-dev/agent';
import { generateText } from 'ai';
import { z } from 'zod';
import { components, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  DEFAULT_CHAT_AGENT_NAME,
  DEFAULT_PERSONA_PROMPT,
  getChatLanguageModel,
  getOpenRouterProvider,
} from './agentChat';
import { DEFAULT_CHAT_MODEL_ID } from '../../src/lib/shared/chat-models';
import {
  getOpenRouterWebSearchPlugin,
  getOpenRouterWebSearchProviderOptions,
} from '../../src/features/chat/lib/openrouter-web-search';

export const CHAT_AGENT_CONTEXT_OPTIONS = {
  recentMessages: 24,
  excludeToolMessages: true,
  searchOptions: {
    limit: 8,
    textSearch: true,
    vectorSearch: false,
    messageRange: { before: 2, after: 1 },
  },
  searchOtherThreads: false,
} as const;

function serializeProviderMetadata(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export async function recordChatUsageEvent(
  ctx: Pick<ActionCtx, 'runQuery' | 'runMutation'>,
  args: {
    agentThreadId: string;
    model: string;
    provider: string;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    providerMetadata?: unknown;
    agentName?: string;
    runId?: Doc<'chatRuns'>['_id'];
  },
) {
  const thread = (await ctx.runQuery(internal.agentChat.getThreadByAgentThreadIdAnyInternal, {
    agentThreadId: args.agentThreadId,
  })) as Doc<'chatThreads'> | null;

  if (!thread) {
    return;
  }

  await ctx.runMutation(internal.agentChat.recordUsageEventInternal, {
    organizationId: thread.organizationId,
    userId: thread.userId,
    threadId: thread._id,
    runId: args.runId,
    agentThreadId: args.agentThreadId,
    agentName: args.agentName,
    model: args.model,
    provider: args.provider,
    totalTokens: args.totalTokens,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    providerMetadataJson: serializeProviderMetadata(args.providerMetadata),
    createdAt: Date.now(),
  });
}

function dedupeSearchSources(
  sources: Array<{
    id: string;
    url: string;
    title?: string;
  }>,
) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

export function createChatWebSearchTool(args?: {
  modelId?: string;
  onResults?: (results: Array<{ id: string; url: string; title?: string }>) => void;
}) {
  return createTool({
    description:
      'Search the web for current information and return a concise summary plus cited URL results.',
    args: z.object({
      query: z.string().min(2),
    }),
    handler: async (_toolCtx, { query }) => {
      const modelId = args?.modelId ?? DEFAULT_CHAT_MODEL_ID;
      const searchModel = getOpenRouterProvider().chat(modelId, {
        plugins: [getOpenRouterWebSearchPlugin(modelId)],
      });
      const searchResult = await generateText({
        model: searchModel,
        prompt: `Search the web for: ${query}\n\nReturn a concise factual summary of the most relevant results.`,
        providerOptions: {
          openrouter: {
            provider: {
              zdr: true,
              data_collection: 'deny',
              ...(getOpenRouterWebSearchProviderOptions(modelId) ?? {}),
            },
          },
        },
      });
      const sources = dedupeSearchSources(
        (searchResult.sources as Array<{ id?: string; url?: string; title?: string }> | undefined)
          ?.flatMap((source) =>
            typeof source?.id === 'string' && typeof source?.url === 'string'
              ? [{ id: source.id, url: source.url, title: source.title }]
              : [],
          ) ?? [],
      );
      args?.onResults?.(sources);

      return {
        query,
        summary: searchResult.text,
        results: sources,
      };
    },
  });
}

export function createChatAgent(args?: {
  modelId?: string;
  instructions?: string;
  useWebSearch?: boolean;
}) {
  const modelId = args?.modelId ?? DEFAULT_CHAT_MODEL_ID;

  return new Agent(components.agent, {
    name: DEFAULT_CHAT_AGENT_NAME,
    languageModel: getChatLanguageModel(modelId, false),
    instructions: args?.instructions ?? DEFAULT_PERSONA_PROMPT,
    contextOptions: CHAT_AGENT_CONTEXT_OPTIONS,
    usageHandler: async (ctx, usageArgs) => {
      if (!usageArgs.threadId) {
        return;
      }

      await recordChatUsageEvent(ctx, {
        agentThreadId: usageArgs.threadId,
        agentName: usageArgs.agentName,
        model: usageArgs.model,
        provider: usageArgs.provider,
        totalTokens: usageArgs.usage.totalTokens,
        inputTokens: usageArgs.usage.inputTokens,
        outputTokens: usageArgs.usage.outputTokens,
        providerMetadata: usageArgs.providerMetadata,
      });
    },
    contextHandler: async (ctx, contextArgs) => {
      if (!contextArgs.threadId) {
        return contextArgs.allMessages;
      }

      const thread = await getThreadMetadata(ctx, components.agent, {
        threadId: contextArgs.threadId,
      });
      const summary = thread.summary?.trim();
      const summaryMessage = summary
        ? [{ role: 'system' as const, content: `Conversation summary:\n${summary}` }]
        : [];

      return [
        ...summaryMessage,
        ...contextArgs.search,
        ...contextArgs.recent,
        ...contextArgs.inputMessages,
        ...contextArgs.inputPrompt,
      ];
    },
    ...(args?.useWebSearch
      ? {
          tools: {
            web_search: createChatWebSearchTool(),
          },
          maxSteps: 4,
        }
      : { maxSteps: 1 }),
  });
}
