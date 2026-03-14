import { describe, expect, it, vi } from 'vitest';
import {
  createActorScopedRateLimitKey,
  createEmailScopedRateLimitKey,
  enforceServerAuthRateLimit,
  SERVER_AUTH_RATE_LIMIT_MESSAGE,
} from './authRateLimits';

vi.mock('../_generated/api', () => ({
  components: {
    rateLimiter: {
      lib: {
        rateLimit: 'rateLimiter.lib.rateLimit',
      },
    },
  },
}));

describe('authRateLimits', () => {
  it('creates distinct actor-scoped buckets for different admins', () => {
    expect(createActorScopedRateLimitKey({ actorUserId: 'admin_1', scope: 'user_1' })).toBe(
      'admin_1:user_1',
    );
    expect(createActorScopedRateLimitKey({ actorUserId: 'admin_2', scope: 'user_1' })).toBe(
      'admin_2:user_1',
    );
  });

  it('normalizes email-scoped buckets for password reset limits', () => {
    expect(createEmailScopedRateLimitKey(' Person@Example.com ')).toBe('person@example.com');
  });

  it('passes the standardized policy through to the shared rate limiter', async () => {
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    await enforceServerAuthRateLimit(
      { runMutation },
      'adminListUsers',
      createActorScopedRateLimitKey({ actorUserId: 'admin_1' }),
    );

    expect(runMutation).toHaveBeenCalledWith('rateLimiter.lib.rateLimit', {
      name: 'auth:admin-list-users',
      key: 'admin_1',
      config: {
        kind: 'token bucket',
        rate: 30,
        period: 15 * 60 * 1000,
        capacity: 30,
      },
    });
  });

  it('throws a generic Too Many Requests error when the bucket is exhausted', async () => {
    const runMutation = vi.fn().mockResolvedValue({ ok: false, retryAfter: 60_000 });

    await expect(
      enforceServerAuthRateLimit(
        { runMutation },
        'requestPasswordReset',
        createEmailScopedRateLimitKey('person@example.com'),
      ),
    ).rejects.toMatchObject({
      message: SERVER_AUTH_RATE_LIMIT_MESSAGE,
      status: 'TOO_MANY_REQUESTS',
    });
  });
});
