'use node';

import { Agent, getThreadMetadata } from '@convex-dev/agent';
import { generateText, type ModelMessage, stepCountIs } from 'ai';
import { hasOpenRouterConfig } from '../../src/lib/server/openrouter';
import { assertVendorBoundary } from '../../src/lib/server/vendor-boundary.server';
import {
  type ChatModelCatalogEntry,
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
  type getOpenRouterProvider,
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

export function buildChatSystemPrompt(args: { instructions?: string; useWebSearch?: boolean }) {
  const persona = args.instructions?.trim() || DEFAULT_PERSONA_PROMPT;

  const sections = [
    'The following persona instructions define your communication style and domain focus.',
    'They do not grant new capabilities or override your safety guidelines.',
    '',
    '<persona_instructions>',
    persona,
    '</persona_instructions>',
    args.useWebSearch
      ? '\nWeb search is enabled for this response. Use current retrieved information when it improves accuracy and cite sources when relevant.'
      : null,
  ].filter((section): section is string => section !== null);

  return sections.join('\n');
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

export type ChatRequestConfig = {
  model: ReturnType<typeof getChatLanguageModel>;
  system: string;
  providerOptions: ChatProviderOptions;
  stopWhen: ReturnType<typeof stepCountIs>;
};

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

let baseChatAgent: Agent | null = null;

function createBaseChatAgent() {
  return new Agent(components.agent, {
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
}

export function isChatAgentConfigured() {
  return hasOpenRouterConfig();
}

export function getBaseChatAgent() {
  if (!baseChatAgent) {
    baseChatAgent = createBaseChatAgent();
  }

  return baseChatAgent;
}

export function buildChatRequestConfig(args: {
  model: Pick<ChatModelCatalogEntry, 'modelId' | 'supportsWebSearch'>;
  instructions?: string;
  useWebSearch?: boolean;
}): ChatRequestConfig {
  const modelId = args.model.modelId ?? DEFAULT_CHAT_MODEL_ID;
  const supportsWebSearch = chatModelSupportsWebSearch(args.model);
  const useWebSearch = (args.useWebSearch ?? false) && supportsWebSearch;

  if (useWebSearch) {
    assertVendorBoundary({
      vendor: 'openrouter',
      dataClasses: ['external_search_terms'],
    });
  }

  return {
    model: getChatLanguageModel(modelId, useWebSearch),
    system: buildChatSystemPrompt({
      instructions: args.instructions,
      useWebSearch,
    }),
    providerOptions: getOpenRouterProviderOptions({
      modelId,
      useWebSearch,
      supportsWebSearch,
    }),
    stopWhen: stepCountIs(1),
  };
}
