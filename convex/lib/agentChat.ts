'use node';

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ModelMessage } from 'ai';
import { ConvexError } from 'convex/values';
import {
  getOpenRouterWebSearchPlugin,
  getOpenRouterWebSearchProviderOptions,
  shouldUseOpenRouterWebSearch,
} from '../../src/features/chat/lib/openrouter-web-search';
import { getOpenRouterConfig } from '../../src/lib/server/openrouter';
import {
  type ChatModelCatalogEntry,
  type ChatModelId,
  chatModelSupportsWebSearch,
  DEFAULT_CHAT_MODEL_ID,
  getAuthorizedChatModel,
} from '../../src/lib/shared/chat-models';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

export type ChatThreadDoc = Doc<'chatThreads'>;
export type ChatAttachmentDoc = Doc<'chatAttachments'>;
export type ChatRunDoc = Doc<'chatRuns'>;
export type ChatPersonaDoc = Doc<'aiPersonas'>;
export type ChatUsageOperationKind = 'chat_turn' | 'web_search' | 'thread_title' | 'thread_summary';
export type ChatRunFailureKind =
  | 'provider_policy'
  | 'provider_unavailable'
  | 'tool_error'
  | 'unknown';

export const DEFAULT_CHAT_AGENT_NAME = 'chat-assistant';
export const DEFAULT_PERSONA_PROMPT = 'You are an AI assistant that helps people find information.';
export const DEFAULT_CHAT_EMBEDDING_MODEL_ID = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';

let openRouterProvider: ReturnType<typeof createOpenRouter> | null = null;
const modelCache = new Map<string, ReturnType<ReturnType<typeof createOpenRouter>['chat']>>();
const SEARCHABLE_MODEL_CACHE_SUFFIX = ':web-search';
const embeddingModelCache = new Map<
  string,
  ReturnType<ReturnType<typeof createOpenRouter>['textEmbeddingModel']>
>();

function stripHtmlTags(text: string) {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
}

export function deriveThreadTitle(args: {
  text: string;
  attachments: Array<{ kind: 'image' | 'document'; name: string }>;
  fallback?: string;
}) {
  const fallback = args.fallback ?? 'New Chat';
  const candidate = stripHtmlTags(
    [args.text.trim(), ...args.attachments.map((attachment) => attachment.name)]
      .filter(Boolean)
      .join(' '),
  ).trim();

  if (!candidate) {
    return fallback;
  }

  return candidate || fallback;
}

function getModelCacheKey(modelId: ChatModelId, supportsWebSearch: boolean) {
  const config = getOpenRouterConfig();
  return supportsWebSearch && shouldUseOpenRouterWebSearch(modelId)
    ? `${modelId}:${config.privacyMode}${SEARCHABLE_MODEL_CACHE_SUFFIX}`
    : `${modelId}:${config.privacyMode}`;
}

function getOpenRouterProviderRoutingSettings() {
  const config = getOpenRouterConfig();

  if (config.privacyMode !== 'strict') {
    return undefined;
  }

  return {
    provider: {
      zdr: true,
      data_collection: 'deny' as const,
    },
  };
}

export function getOpenRouterProvider() {
  if (!openRouterProvider) {
    const config = getOpenRouterConfig();
    openRouterProvider = createOpenRouter({
      apiKey: config.apiKey,
      compatibility: config.compatibility,
      ...(config.headers ? { headers: config.headers } : {}),
    });
  }

  return openRouterProvider;
}

export function getChatLanguageModel(modelId: ChatModelId, supportsWebSearch: boolean) {
  const cacheKey = getModelCacheKey(modelId, supportsWebSearch);
  const cached = modelCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const nextModel = getOpenRouterProvider().chat(modelId, {
    ...(supportsWebSearch && shouldUseOpenRouterWebSearch(modelId)
      ? { plugins: [getOpenRouterWebSearchPlugin(modelId)] }
      : {}),
  });
  modelCache.set(cacheKey, nextModel);
  return nextModel;
}

export function getChatEmbeddingModel() {
  const config = getOpenRouterConfig();
  const cacheKey = `${DEFAULT_CHAT_EMBEDDING_MODEL_ID}:${config.privacyMode}`;
  const cached = embeddingModelCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const embeddingModel = getOpenRouterProvider().textEmbeddingModel(
    DEFAULT_CHAT_EMBEDDING_MODEL_ID,
    getOpenRouterProviderRoutingSettings(),
  );
  embeddingModelCache.set(cacheKey, embeddingModel);
  return embeddingModel;
}

export function getOpenRouterProviderOptions(args: {
  modelId: ChatModelId;
  useWebSearch: boolean;
  supportsWebSearch?: boolean;
}) {
  const useProviderSearch = args.useWebSearch && args.supportsWebSearch !== false;
  const routingSettings = getOpenRouterProviderRoutingSettings();

  return {
    openrouter: {
      ...(routingSettings ?? {}),
      ...(useProviderSearch ? (getOpenRouterWebSearchProviderOptions(args.modelId) ?? {}) : {}),
    },
  } as const;
}

export function resolveChatModelId(args: {
  requestedModelId?: string;
  threadModelId?: string;
  availableModels: ChatModelCatalogEntry[];
  isSiteAdmin: boolean;
}) {
  if (args.requestedModelId) {
    const authorized = getAuthorizedChatModel(
      args.requestedModelId,
      args.availableModels,
      args.isSiteAdmin,
    );
    if (!authorized.ok) {
      throw new ConvexError(
        authorized.reason === 'forbidden'
          ? 'This chat model is only available to site admins.'
          : 'Unsupported chat model.',
      );
    }

    return authorized.model;
  }

  if (args.threadModelId) {
    const authorized = getAuthorizedChatModel(
      args.threadModelId,
      args.availableModels,
      args.isSiteAdmin,
    );
    if (authorized.ok) {
      return authorized.model;
    }
  }

  const fallback = getAuthorizedChatModel(
    DEFAULT_CHAT_MODEL_ID,
    args.availableModels,
    args.isSiteAdmin,
  );
  if (fallback.ok) {
    return fallback.model;
  }

  const firstAvailable = args.availableModels.find(
    (model) => model.access === 'public' || args.isSiteAdmin,
  );
  if (!firstAvailable) {
    throw new ConvexError('No chat models are currently available.');
  }

  return firstAvailable;
}

export function assertChatModelSupportsWebSearch(args: {
  useWebSearch: boolean;
  model: Pick<ChatModelCatalogEntry, 'supportsWebSearch'>;
}) {
  if (args.useWebSearch && !chatModelSupportsWebSearch(args.model)) {
    throw new ConvexError('Web search is not supported for the selected model.');
  }
}

export function buildUsageMetadata(usage: {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return {
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function serializeForTransport(value: unknown): unknown {
  if (value instanceof URL) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeForTransport(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeForTransport(item)]),
    );
  }

  return value;
}

export async function serializeMessagesForTransport(messages: ModelMessage[]) {
  return messages.map((message) => serializeForTransport(message));
}

export function extractAssistantText(messages: Array<{ role: string; content: unknown }>) {
  return messages
    .flatMap((message) => {
      if (message.role !== 'assistant') {
        return [];
      }

      if (typeof message.content === 'string') {
        return [message.content];
      }

      if (!Array.isArray(message.content)) {
        return [];
      }

      return message.content
        .filter(
          (part): part is { type: 'text'; text: string } =>
            typeof part === 'object' &&
            part !== null &&
            'type' in part &&
            part.type === 'text' &&
            'text' in part &&
            typeof part.text === 'string',
        )
        .map((part) => part.text);
    })
    .join('');
}

export async function getAttachmentPreviewUrl(
  ctx: ActionCtx | QueryCtx | MutationCtx,
  attachment: ChatAttachmentDoc,
) {
  if (attachment.kind !== 'image' || !attachment.rawStorageId || !('storage' in ctx)) {
    return null;
  }

  return await ctx.storage.getUrl(attachment.rawStorageId);
}

export function getThreadSortKey(thread: Pick<ChatThreadDoc, 'pinned' | 'updatedAt'>) {
  return `${thread.pinned ? '0' : '1'}:${String(-thread.updatedAt).padStart(16, '0')}`;
}

export function isRunActive(run: ChatRunDoc | null | undefined) {
  return run?.status === 'streaming';
}

export function toFailureStatus(reason: 'abort' | 'error') {
  return reason === 'abort' ? 'aborted' : 'error';
}

export function classifyChatRunFailure(error: unknown): ChatRunFailureKind {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();

  if (
    normalized.includes('guardrail restrictions') ||
    normalized.includes('data policy') ||
    normalized.includes('privacy')
  ) {
    return 'provider_policy';
  }

  if (
    normalized.includes('no endpoints available') ||
    normalized.includes('provider unavailable') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('no compatible endpoint')
  ) {
    return 'provider_unavailable';
  }

  if (normalized.includes('tool')) {
    return 'tool_error';
  }

  return 'unknown';
}

export function getLatestRun<R extends Pick<ChatRunDoc, 'startedAt'>>(runs: R[]) {
  return [...runs].sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
}

export function normalizeOptionalString(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function ensureThreadId(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
): Id<'chatThreads'> | null {
  return ctx.db.normalizeId('chatThreads', threadId);
}
