'use node';

import { Agent, createTool, getThreadMetadata } from '@convex-dev/agent';
import { generateText, type ModelMessage, stepCountIs } from 'ai';
import { z } from 'zod';
import { getOpenRouterWebSearchPlugin } from '../../src/features/chat/lib/openrouter-web-search';
import {
  type ChatModelCatalogEntry,
  type ChatModelId,
  chatModelSupportsWebSearch,
  DEFAULT_CHAT_MODEL_ID,
} from '../../src/lib/shared/chat-models';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  type ChatThreadDoc,
  type ChatUsageOperationKind,
  DEFAULT_CHAT_AGENT_NAME,
  DEFAULT_PERSONA_PROMPT,
  getChatEmbeddingModel,
  getChatLanguageModel,
  getOpenRouterProvider,
  getOpenRouterProviderOptions,
} from './agentChat';
import { normalizeChatUsage } from './chatRateLimits';

export const CHAT_AGENT_CONTEXT_OPTIONS = {
  recentMessages: 24,
  excludeToolMessages: true,
  searchOptions: {
    limit: 8,
    textSearch: true,
    vectorSearch: true,
    messageRange: { before: 2, after: 1 },
  },
  searchOtherThreads: false,
} as const;

export type ChatWebSearchSource = {
  id: string;
  url: string;
  title?: string;
};

type ChatContextMessages = {
  search: ModelMessage[];
  recent: ModelMessage[];
  inputMessages: ModelMessage[];
  inputPrompt: ModelMessage[];
  existingResponses: ModelMessage[];
};

type ChatUsageMutationCtx = Pick<ActionCtx, 'runQuery' | 'runMutation'>;
type ChatProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>;
type ChatUsageThreadRef = Pick<
  ChatThreadDoc,
  '_id' | 'agentThreadId' | 'organizationId' | 'ownerUserId'
>;

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

function getProviderMetadata(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return value;
}

async function persistChatUsageEvent(
  ctx: ChatUsageMutationCtx,
  args: {
    thread: ChatUsageThreadRef;
    actorUserId: string;
    runId?: Id<'chatRuns'>;
    operationKind: ChatUsageOperationKind;
    model: string;
    provider: string;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    providerMetadata?: unknown;
    agentName?: string;
  },
) {
  const usage = normalizeChatUsage(args);

  await ctx.runMutation(internal.agentChat.recordUsageEventInternal, {
    organizationId: args.thread.organizationId,
    actorUserId: args.actorUserId,
    threadOwnerUserId: args.thread.ownerUserId,
    threadId: args.thread._id,
    runId: args.runId,
    agentThreadId: args.thread.agentThreadId,
    agentName: args.agentName,
    operationKind: args.operationKind,
    model: args.model,
    provider: args.provider,
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    providerMetadataJson: serializeProviderMetadata(args.providerMetadata),
    createdAt: Date.now(),
  });
}

export async function recordChatUsageEvent(
  ctx: ChatUsageMutationCtx,
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

  await persistChatUsageEvent(ctx, {
    thread,
    actorUserId: run?.initiatedByUserId ?? thread.ownerUserId,
    runId: run?._id,
    operationKind: 'chat_turn',
    model: args.model,
    provider: args.provider,
    totalTokens: args.totalTokens,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    providerMetadata: args.providerMetadata,
    agentName: args.agentName,
  });
}

export async function trackedGenerateText(
  ctx: ChatUsageMutationCtx,
  args: {
    thread: ChatUsageThreadRef;
    actorUserId: string;
    runId?: Id<'chatRuns'>;
    operationKind: Exclude<ChatUsageOperationKind, 'chat_turn'>;
    model: ReturnType<ReturnType<typeof getOpenRouterProvider>['chat']>;
    modelId: string;
    provider?: string;
    prompt: string;
    providerOptions?: ChatProviderOptions;
  },
) {
  const result = await generateText({
    model: args.model,
    prompt: args.prompt,
    ...(args.providerOptions ? { providerOptions: args.providerOptions } : {}),
  });

  await persistChatUsageEvent(ctx, {
    thread: args.thread,
    actorUserId: args.actorUserId,
    runId: args.runId,
    operationKind: args.operationKind,
    model: args.modelId,
    provider: args.provider ?? 'openrouter',
    totalTokens: result.usage?.totalTokens,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    providerMetadata: getProviderMetadata(result.providerMetadata),
  });

  return result;
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

export function buildChatSystemPrompt(args: { instructions?: string; useWebSearch?: boolean }) {
  const promptSections = [
    args.instructions?.trim() || DEFAULT_PERSONA_PROMPT,
    args.useWebSearch
      ? 'When current or recent web information is needed, use the web_search tool.'
      : null,
  ].filter((section): section is string => Boolean(section));

  return promptSections.join('\n\n');
}

export function buildChatContextMessages(args: { summary?: string; context: ChatContextMessages }) {
  const summary = args.summary?.trim();
  const summaryMessage = summary
    ? [{ role: 'system' as const, content: `Conversation summary:\n${summary}` }]
    : [];

  return [
    ...summaryMessage,
    ...args.context.search,
    ...args.context.recent,
    ...args.context.inputMessages,
    ...args.context.inputPrompt,
    ...args.context.existingResponses,
  ];
}

type ChatRequestConfig = {
  model: ReturnType<typeof getChatLanguageModel>;
  system: string;
} & (
  | {
      stopWhen: ReturnType<typeof stepCountIs>;
      providerOptions?: undefined;
      tools?: undefined;
    }
  | {
      stopWhen: ReturnType<typeof stepCountIs>;
      providerOptions?: undefined;
      tools: {
        web_search: ReturnType<typeof createChatWebSearchTool>;
      };
    }
);

export async function runChatWebSearch(
  ctx: ChatUsageMutationCtx,
  args: {
    query: string;
    modelId?: ChatModelId;
    thread: ChatUsageThreadRef;
    actorUserId: string;
    runId?: Id<'chatRuns'>;
  },
) {
  const modelId = args.modelId ?? DEFAULT_CHAT_MODEL_ID;
  const searchModel = getOpenRouterProvider().chat(modelId, {
    plugins: [getOpenRouterWebSearchPlugin(modelId)],
  });
  const searchResult = await trackedGenerateText(ctx, {
    thread: args.thread,
    actorUserId: args.actorUserId,
    runId: args.runId,
    operationKind: 'web_search',
    model: searchModel,
    modelId,
    provider: 'openrouter',
    prompt: `Search the web for: ${args.query}\n\nReturn a concise factual summary of the most relevant results.`,
    providerOptions: getOpenRouterProviderOptions({
      modelId,
      useWebSearch: true,
    }),
  });
  const results = dedupeSearchSources(
    (
      searchResult.sources as Array<{ id?: string; url?: string; title?: string }> | undefined
    )?.flatMap((source) =>
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

export function createChatWebSearchTool(args: {
  modelId?: ChatModelId;
  thread: ChatUsageThreadRef;
  actorUserId: string;
  runId?: Id<'chatRuns'>;
  onResults?: (results: ChatWebSearchSource[]) => void;
}) {
  return createTool({
    description:
      'Search the web for current information and return a concise summary plus cited URL results.',
    args: z.object({
      query: z.string().min(2),
    }),
    handler: async (toolCtx, { query }) => {
      const result = await runChatWebSearch(toolCtx, {
        query,
        modelId: args.modelId,
        thread: args.thread,
        actorUserId: args.actorUserId,
        runId: args.runId,
      });
      args.onResults?.(result.results);
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
  textEmbeddingModel: getChatEmbeddingModel(),
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
    return buildChatContextMessages({
      summary: thread.summary,
      context: contextArgs,
    });
  },
  rawRequestResponseHandler: async (_ctx, args) => {
    await debugRawRequestResponse(args);
  },
});

export function buildChatRequestConfig(args: {
  model: Pick<ChatModelCatalogEntry, 'modelId' | 'supportsWebSearch'>;
  instructions?: string;
  useWebSearch?: boolean;
  thread: ChatUsageThreadRef;
  actorUserId: string;
  runId?: Id<'chatRuns'>;
  onWebSearchResults?: (results: ChatWebSearchSource[]) => void;
}): ChatRequestConfig {
  const modelId = args.model.modelId ?? DEFAULT_CHAT_MODEL_ID;
  const supportsWebSearch = chatModelSupportsWebSearch(args.model);
  const useWebSearch = (args.useWebSearch ?? false) && supportsWebSearch;
  const baseConfig = {
    model: getChatLanguageModel(modelId, false),
    system: buildChatSystemPrompt({
      instructions: args.instructions,
      useWebSearch,
    }),
  };

  if (!useWebSearch) {
    return {
      ...baseConfig,
      stopWhen: stepCountIs(1),
    };
  }

  return {
    ...baseConfig,
    tools: {
      web_search: createChatWebSearchTool({
        modelId,
        thread: args.thread,
        actorUserId: args.actorUserId,
        runId: args.runId,
        onResults: args.onWebSearchResults,
      }),
    },
    stopWhen: stepCountIs(4),
  };
}
