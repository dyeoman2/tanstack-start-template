'use node';

import { Agent, createTool, getThreadMetadata } from '@convex-dev/agent';
import { generateText, stepCountIs } from 'ai';
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
import { DEFAULT_CHAT_MODEL_ID, type ChatModelId } from '../../src/lib/shared/chat-models';
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

export type ChatWebSearchSource = {
  id: string;
  url: string;
  title?: string;
};

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
  },
) {
  const thread = (await ctx.runQuery(internal.agentChat.getThreadByAgentThreadIdAnyInternal, {
    agentThreadId: args.agentThreadId,
  })) as Doc<'chatThreads'> | null;

  if (!thread) {
    return;
  }

  const run = (await ctx.runQuery(internal.agentChat.getLatestActiveRunForThreadInternal, {
    threadId: thread._id,
  })) as Doc<'chatRuns'> | null;

  await ctx.runMutation(internal.agentChat.recordUsageEventInternal, {
    organizationId: thread.organizationId,
    userId: thread.userId,
    threadId: thread._id,
    runId: run?._id,
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

function dedupeSearchSources(sources: ChatWebSearchSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

export function buildChatSystemPrompt(args: {
  instructions?: string;
  useWebSearch?: boolean;
}) {
  const promptSections = [
    args.instructions?.trim() || DEFAULT_PERSONA_PROMPT,
    args.useWebSearch
      ? 'When current or recent web information is needed, use the web_search tool.'
      : null,
  ].filter((section): section is string => Boolean(section));

  return promptSections.join('\n\n');
}

export async function runChatWebSearch(args: {
  query: string;
  modelId?: ChatModelId;
}) {
  const modelId = args.modelId ?? DEFAULT_CHAT_MODEL_ID;
  const searchModel = getOpenRouterProvider().chat(modelId, {
    plugins: [getOpenRouterWebSearchPlugin(modelId)],
  });
  const searchResult = await generateText({
    model: searchModel,
    prompt: `Search the web for: ${args.query}\n\nReturn a concise factual summary of the most relevant results.`,
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
  const results = dedupeSearchSources(
    (searchResult.sources as Array<{ id?: string; url?: string; title?: string }> | undefined)
      ?.flatMap((source) =>
        typeof source?.id === 'string' && typeof source?.url === 'string'
          ? [{ id: source.id, url: source.url, title: source.title }]
          : [],
      ) ?? [],
  );

  return {
    query: args.query,
    summary: searchResult.text,
    results,
  };
}

export function createChatWebSearchTool(args?: {
  modelId?: ChatModelId;
  onResults?: (results: ChatWebSearchSource[]) => void;
}) {
  return createTool({
    description:
      'Search the web for current information and return a concise summary plus cited URL results.',
    args: z.object({
      query: z.string().min(2),
    }),
    handler: async (_toolCtx, { query }) => {
      const result = await runChatWebSearch({
        query,
        modelId: args?.modelId,
      });
      args?.onResults?.(result.results);
      return result;
    },
  });
}

async function debugRawRequestResponse(args: {
  threadId?: string;
  agentName?: string;
  request: unknown;
  response: unknown;
}) {
  if (process.env.DEBUG_LLM !== 'true') {
    return;
  }

  console.log('[chat.debug.llm]', JSON.stringify(args));
}

export const baseChatAgent = new Agent(components.agent, {
  name: DEFAULT_CHAT_AGENT_NAME,
  languageModel: getChatLanguageModel(DEFAULT_CHAT_MODEL_ID, false),
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
  rawRequestResponseHandler: async (_ctx, args) => {
    await debugRawRequestResponse(args);
  },
});

export function buildChatRequestConfig(args: {
  modelId?: ChatModelId;
  instructions?: string;
  useWebSearch?: boolean;
  onWebSearchResults?: (results: ChatWebSearchSource[]) => void;
}) {
  const modelId = args.modelId ?? DEFAULT_CHAT_MODEL_ID;
  const useWebSearch = args.useWebSearch ?? false;

  return {
    model: getChatLanguageModel(modelId, false),
    system: buildChatSystemPrompt({
      instructions: args.instructions,
      useWebSearch,
    }),
    ...(useWebSearch
      ? {
          tools: {
            web_search: createChatWebSearchTool({
              modelId,
              onResults: args.onWebSearchResults,
            }),
          },
          stopWhen: stepCountIs(4),
        }
      : {
          stopWhen: stepCountIs(1),
        }),
  };
}
