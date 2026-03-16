import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from 'better-auth/api';

function toMillis(value: Date | number | string | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function createFreshSessionPlugin(): BetterAuthPlugin {
  return {
    id: 'fresh-session',
    endpoints: {
      assertFreshSession: createAuthEndpoint(
        '/session/assert-fresh',
        {
          method: 'GET',
          requireHeaders: true,
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          const session = ctx.context.session?.session;
          if (!session) {
            throw APIError.from('UNAUTHORIZED', {
              code: 'UNAUTHORIZED',
              message: 'Unauthorized',
            });
          }

          const freshAgeSeconds = ctx.context.sessionConfig.freshAge;
          const verifiedAt = toMillis(session.updatedAt ?? session.createdAt);
          const validUntil = verifiedAt + freshAgeSeconds * 1000;

          if (verifiedAt <= 0 || (freshAgeSeconds > 0 && validUntil <= Date.now())) {
            throw APIError.from('FORBIDDEN', {
              code: 'SESSION_NOT_FRESH',
              message: 'Session is not fresh',
            });
          }

          return ctx.json({
            sessionId: session.id,
            validUntil,
            verifiedAt,
          });
        },
      ),
    },
  };
}
