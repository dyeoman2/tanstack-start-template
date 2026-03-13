import { RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const MINUTE_MS = 60 * 1000;
const GLOBAL_CHAT_PROVIDER_KEY = 'chat-provider-global';

export const CHAT_RATE_LIMITS = {
  chatUserRequests: {
    kind: 'token bucket' as const,
    rate: 12,
    period: MINUTE_MS,
    capacity: 12,
  },
  chatGlobalRequests: {
    kind: 'token bucket' as const,
    rate: 240,
    period: MINUTE_MS,
    capacity: 240,
    shards: 10,
  },
  chatUserActualTokens: {
    kind: 'token bucket' as const,
    rate: 40_000,
    period: MINUTE_MS,
    capacity: 40_000,
    maxReserved: 40_000,
  },
  chatGlobalActualTokens: {
    kind: 'token bucket' as const,
    rate: 800_000,
    period: MINUTE_MS,
    capacity: 800_000,
    maxReserved: 800_000,
    shards: 10,
  },
};

const chatRateLimiter = new RateLimiter(components.rateLimiter, CHAT_RATE_LIMITS);

type RateLimitCheckCtx = Pick<QueryCtx, 'runQuery'>;
type RateLimitMutationCtx = Pick<MutationCtx, 'runQuery' | 'runMutation'>;

export type ChatRateLimitStatus = {
  ok: boolean;
  retryAfter?: number;
};

export type AdvisoryChatRateLimit = {
  request: ChatRateLimitStatus;
  estimatedTokens: ChatRateLimitStatus;
  estimatedInputTokens: number;
};

export type NormalizedChatUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export function buildChatRateLimitKey(args: { organizationId: string; userId: string }) {
  return `${args.organizationId}:${args.userId}`;
}

export function estimateChatInputTokens(args: { textLength?: number; hasAttachments?: boolean }) {
  const textTokens = Math.max(1, Math.ceil((args.textLength ?? 0) / 4));
  return textTokens + (args.hasAttachments ? 1_200 : 0);
}

export function normalizeChatUsage(args: {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}): NormalizedChatUsage {
  const inputTokens = Math.max(0, args.inputTokens ?? 0);
  const outputTokens = Math.max(0, args.outputTokens ?? 0);
  const totalTokens = Math.max(0, args.totalTokens ?? inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function buildChatUsageAggregatePatch(
  run: {
    actualInputTokens?: number;
    actualOutputTokens?: number;
    actualTotalTokens?: number;
    usageEventCount?: number;
  },
  usage: NormalizedChatUsage,
  recordedAt: number,
) {
  return {
    actualInputTokens: (run.actualInputTokens ?? 0) + usage.inputTokens,
    actualOutputTokens: (run.actualOutputTokens ?? 0) + usage.outputTokens,
    actualTotalTokens: (run.actualTotalTokens ?? 0) + usage.totalTokens,
    usageEventCount: (run.usageEventCount ?? 0) + 1,
    usageRecordedAt: recordedAt,
  };
}

function formatRetryAfterMessage(retryAfter?: number) {
  if (!retryAfter || retryAfter <= 0) {
    return 'Please try again shortly.';
  }

  return `Try again in ${Math.max(1, Math.ceil(retryAfter / 1000))} seconds.`;
}

export function getChatRateLimitErrorMessage(args: {
  scope: 'user' | 'global';
  kind: 'request' | 'token';
  retryAfter?: number;
}) {
  if (args.scope === 'global') {
    return `AI capacity is temporarily full. ${formatRetryAfterMessage(args.retryAfter)}`;
  }

  if (args.kind === 'request') {
    return `Rate limit exceeded. ${formatRetryAfterMessage(args.retryAfter)}`;
  }

  return `Token budget exceeded. ${formatRetryAfterMessage(args.retryAfter)}`;
}

async function checkUserEstimatedTokenBudget(
  ctx: RateLimitCheckCtx,
  args: {
    organizationId: string;
    userId: string;
    estimatedInputTokens: number;
  },
) {
  return await chatRateLimiter.check(ctx, 'chatUserActualTokens', {
    key: buildChatRateLimitKey(args),
    count: args.estimatedInputTokens,
  });
}

export async function getAdvisoryChatRateLimit(
  ctx: RateLimitCheckCtx,
  args: {
    organizationId: string;
    userId: string;
    textLength?: number;
    hasAttachments?: boolean;
  },
): Promise<AdvisoryChatRateLimit> {
  const estimatedInputTokens = estimateChatInputTokens(args);
  const request = await chatRateLimiter.check(ctx, 'chatUserRequests', {
    key: buildChatRateLimitKey(args),
  });
  const estimatedTokens = await checkUserEstimatedTokenBudget(ctx, {
    organizationId: args.organizationId,
    userId: args.userId,
    estimatedInputTokens,
  });

  return {
    request,
    estimatedTokens,
    estimatedInputTokens,
  };
}

async function throwForRateLimit(args: {
  scope: 'user' | 'global';
  kind: 'request' | 'token';
  retryAfter?: number;
}): Promise<never> {
  throw new ConvexError(getChatRateLimitErrorMessage(args));
}

export async function enforceChatPreflightOrThrow(
  ctx: RateLimitMutationCtx,
  args: {
    organizationId: string;
    userId: string;
    textLength?: number;
    hasAttachments?: boolean;
  },
) {
  const key = buildChatRateLimitKey(args);
  const estimatedInputTokens = estimateChatInputTokens(args);
  const userEstimatedTokens = await chatRateLimiter.check(ctx, 'chatUserActualTokens', {
    key,
    count: estimatedInputTokens,
  });
  if (!userEstimatedTokens.ok) {
    await throwForRateLimit({
      scope: 'user',
      kind: 'token',
      retryAfter: userEstimatedTokens.retryAfter,
    });
  }

  const globalEstimatedTokens = await chatRateLimiter.check(ctx, 'chatGlobalActualTokens', {
    key: GLOBAL_CHAT_PROVIDER_KEY,
    count: estimatedInputTokens,
  });
  if (!globalEstimatedTokens.ok) {
    await throwForRateLimit({
      scope: 'global',
      kind: 'token',
      retryAfter: globalEstimatedTokens.retryAfter,
    });
  }

  const userRequest = await chatRateLimiter.limit(ctx, 'chatUserRequests', { key });
  if (!userRequest.ok) {
    await throwForRateLimit({
      scope: 'user',
      kind: 'request',
      retryAfter: userRequest.retryAfter,
    });
  }

  const globalRequest = await chatRateLimiter.limit(ctx, 'chatGlobalRequests', {
    key: GLOBAL_CHAT_PROVIDER_KEY,
  });
  if (!globalRequest.ok) {
    await throwForRateLimit({
      scope: 'global',
      kind: 'request',
      retryAfter: globalRequest.retryAfter,
    });
  }
}

export async function chargeActualChatTokens(
  ctx: RateLimitMutationCtx,
  args: {
    organizationId: string;
    userId: string;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  const usage = normalizeChatUsage(args);
  if (usage.totalTokens <= 0) {
    return usage;
  }

  const key = buildChatRateLimitKey(args);
  await chatRateLimiter.limit(ctx, 'chatUserActualTokens', {
    key,
    count: usage.totalTokens,
    reserve: true,
  });
  await chatRateLimiter.limit(ctx, 'chatGlobalActualTokens', {
    key: GLOBAL_CHAT_PROVIDER_KEY,
    count: usage.totalTokens,
    reserve: true,
  });

  return usage;
}
