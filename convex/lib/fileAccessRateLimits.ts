import { RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { ActionCtx, MutationCtx } from '../_generated/server';

const MINUTE_MS = 60 * 1000;

export const FILE_ACCESS_RATE_LIMITS = {
  fileAccessTickets: {
    kind: 'token bucket' as const,
    rate: 30,
    period: 15 * MINUTE_MS,
    capacity: 30,
  },
};

const fileAccessRateLimiter = new RateLimiter(components.rateLimiter, FILE_ACCESS_RATE_LIMITS);

type RateLimitMutationCtx = Pick<MutationCtx | ActionCtx, 'runQuery' | 'runMutation'>;

function buildFileAccessRateLimitKey(args: { organizationId: string; userId: string }) {
  return `file-access:${args.organizationId}:${args.userId}`;
}

export async function enforceFileAccessTicketRateLimitOrThrow(
  ctx: RateLimitMutationCtx,
  args: {
    organizationId: string;
    userId: string;
  },
) {
  const result = await fileAccessRateLimiter.limit(ctx, 'fileAccessTickets', {
    key: buildFileAccessRateLimitKey(args),
  });
  if (!result.ok) {
    const retryAfter = result.retryAfter ?? 0;
    const seconds = Math.max(1, Math.ceil(retryAfter / 1000));
    throw new ConvexError(`File access rate limit exceeded. Try again in ${seconds} seconds.`);
  }
}
