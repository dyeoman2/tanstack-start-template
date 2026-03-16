import { APIError } from 'better-auth/api';
import type { ActionCtx, MutationCtx } from '../_generated/server';
import { components } from '../_generated/api';

type RateLimitConfig = {
  capacity: number;
  kind: 'fixed window' | 'token bucket';
  period: number;
  rate: number;
};

type RateLimitContext = Pick<ActionCtx, 'runMutation'> | Pick<MutationCtx, 'runMutation'>;

export const SERVER_AUTH_RATE_LIMIT_MESSAGE = 'Too many auth requests. Please try again later.';

export const SERVER_AUTH_RATE_LIMIT_POLICIES = {
  adminBanUser: {
    bucket: 'auth:admin-ban-user',
    config: { kind: 'token bucket', rate: 20, period: 15 * 60 * 1000, capacity: 20 },
  },
  adminCreateUser: {
    bucket: 'auth:admin-create-user',
    config: { kind: 'token bucket', rate: 10, period: 60 * 60 * 1000, capacity: 10 },
  },
  adminGetUser: {
    bucket: 'auth:admin-get-user',
    config: { kind: 'token bucket', rate: 120, period: 15 * 60 * 1000, capacity: 120 },
  },
  adminListUserSessions: {
    bucket: 'auth:admin-list-user-sessions',
    config: { kind: 'token bucket', rate: 30, period: 15 * 60 * 1000, capacity: 30 },
  },
  adminListUsers: {
    bucket: 'auth:admin-list-users',
    config: { kind: 'token bucket', rate: 30, period: 15 * 60 * 1000, capacity: 30 },
  },
  adminRemoveUser: {
    bucket: 'auth:admin-remove-user',
    config: { kind: 'token bucket', rate: 10, period: 15 * 60 * 1000, capacity: 10 },
  },
  adminRevokeUserSession: {
    bucket: 'auth:admin-revoke-user-session',
    config: { kind: 'token bucket', rate: 20, period: 15 * 60 * 1000, capacity: 20 },
  },
  adminRevokeUserSessions: {
    bucket: 'auth:admin-revoke-user-sessions',
    config: { kind: 'token bucket', rate: 10, period: 15 * 60 * 1000, capacity: 10 },
  },
  adminSetRole: {
    bucket: 'auth:admin-set-role',
    config: { kind: 'token bucket', rate: 20, period: 15 * 60 * 1000, capacity: 20 },
  },
  adminSetUserPassword: {
    bucket: 'auth:admin-set-user-password',
    config: { kind: 'token bucket', rate: 10, period: 15 * 60 * 1000, capacity: 10 },
  },
  adminUnbanUser: {
    bucket: 'auth:admin-unban-user',
    config: { kind: 'token bucket', rate: 20, period: 15 * 60 * 1000, capacity: 20 },
  },
  adminUpdateUser: {
    bucket: 'auth:admin-update-user',
    config: { kind: 'token bucket', rate: 30, period: 15 * 60 * 1000, capacity: 30 },
  },
  requestPasswordReset: {
    bucket: 'auth:request-password-reset',
    config: { kind: 'token bucket', rate: 3, period: 60 * 60 * 1000, capacity: 3 },
  },
} as const satisfies Record<string, { bucket: string; config: RateLimitConfig }>;

export type ServerAuthRateLimitName = keyof typeof SERVER_AUTH_RATE_LIMIT_POLICIES;

type ActorScopedKeyInput = {
  actorUserId: string;
  scope?: string | null;
};

function normalizeKeySegment(value: string): string {
  return value.trim().toLowerCase();
}

export function createActorScopedRateLimitKey({
  actorUserId,
  scope,
}: ActorScopedKeyInput): string {
  const segments = [normalizeKeySegment(actorUserId)];
  if (scope && scope.trim().length > 0) {
    segments.push(normalizeKeySegment(scope));
  }

  return segments.join(':');
}

export function createEmailScopedRateLimitKey(email: string): string {
  return normalizeKeySegment(email);
}

export async function enforceServerAuthRateLimit(
  ctx: RateLimitContext,
  name: ServerAuthRateLimitName,
  key: string,
): Promise<void> {
  const policy = SERVER_AUTH_RATE_LIMIT_POLICIES[name];
  const result = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
    name: policy.bucket,
    key,
    config: policy.config,
  });

  if (!result.ok) {
    throw APIError.fromStatus('TOO_MANY_REQUESTS', {
      message: SERVER_AUTH_RATE_LIMIT_MESSAGE,
    });
  }
}
