import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  isAuthAuditEventType,
  normalizeAuditIdentifier,
  type AuthAuditEvent,
} from '../src/lib/shared/auth-audit';
import { assertUserId } from '../src/lib/shared/user-id';
import type { Doc } from './_generated/dataModel';
import { internalMutation, query, type QueryCtx } from './_generated/server';
import { getCurrentAuthUserOrNull } from './auth/access';
import { throwConvexError } from './auth/errors';

type AuditLogDoc = Doc<'auditLogs'>;

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseMetadata(metadata: string | undefined) {
  if (!metadata) {
    return undefined;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

function toAuditEvent(log: AuditLogDoc): AuthAuditEvent | null {
  if (!isAuthAuditEventType(log.eventType)) {
    return null;
  }

  return {
    id: log.id,
    eventType: log.eventType,
    ...(log.userId ? { userId: log.userId } : {}),
    ...(log.organizationId ? { organizationId: log.organizationId } : {}),
    ...(log.identifier ? { identifier: log.identifier } : {}),
    createdAt: log.createdAt,
    ...(log.ipAddress ? { ipAddress: log.ipAddress } : {}),
    ...(log.userAgent ? { userAgent: log.userAgent } : {}),
    ...(log.metadata ? { metadata: parseMetadata(log.metadata) } : {}),
  };
}

function compareByCreatedAtDesc(left: AuthAuditEvent, right: AuthAuditEvent) {
  const createdAtDiff = right.createdAt - left.createdAt;
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return right.id.localeCompare(left.id);
}

function dedupeEvents(events: AuthAuditEvent[]) {
  const uniqueEvents = new Map<string, AuthAuditEvent>();

  for (const event of events) {
    if (!uniqueEvents.has(event.id)) {
      uniqueEvents.set(event.id, event);
    }
  }

  return Array.from(uniqueEvents.values());
}

async function collectAuditLogsForAdmin(
  ctx: QueryCtx,
  filters: {
    eventType?: string;
    identifier?: string;
    organizationId?: string;
    userId?: string;
  },
) {
  const { eventType, identifier, organizationId, userId } = filters;

  if (userId) {
    return ctx.db
      .query('auditLogs')
      .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .collect();
  }

  if (identifier) {
    return ctx.db
      .query('auditLogs')
      .withIndex('by_identifier_and_createdAt', (q) => q.eq('identifier', identifier))
      .order('desc')
      .collect();
  }

  if (eventType) {
    return ctx.db
      .query('auditLogs')
      .withIndex('by_eventType_and_createdAt', (q) => q.eq('eventType', eventType))
      .order('desc')
      .collect();
  }

  if (organizationId) {
    return ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_createdAt', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .collect();
  }

  return ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').collect();
}

async function collectAuditLogsForUser(
  ctx: QueryCtx,
  currentUserId: string,
  currentIdentifier: string | undefined,
) {
  const logsByUserIdPromise = ctx.db
    .query('auditLogs')
    .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', currentUserId))
    .order('desc')
    .collect();

  const logsByIdentifierPromise = currentIdentifier
    ? ctx.db
        .query('auditLogs')
        .withIndex('by_identifier_and_createdAt', (q) => q.eq('identifier', currentIdentifier))
        .order('desc')
        .collect()
    : Promise.resolve([] satisfies AuditLogDoc[]);

  const [logsByUserId, logsByIdentifier] = await Promise.all([
    logsByUserIdPromise,
    logsByIdentifierPromise,
  ]);

  return [...logsByUserId, ...logsByIdentifier];
}

export const insertAuditLog = internalMutation({
  args: {
    eventType: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    metadata: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isAuthAuditEventType(args.eventType)) {
      throw new Error(`Unsupported audit event type: ${args.eventType}`);
    }

    await ctx.db.insert('auditLogs', {
      id: crypto.randomUUID(),
      eventType: args.eventType,
      ...(normalizeOptionalString(args.userId)
        ? { userId: normalizeOptionalString(args.userId) }
        : {}),
      ...(normalizeOptionalString(args.organizationId)
        ? { organizationId: normalizeOptionalString(args.organizationId) }
        : {}),
      ...(normalizeAuditIdentifier(args.identifier)
        ? { identifier: normalizeAuditIdentifier(args.identifier) }
        : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
      createdAt: args.createdAt ?? Date.now(),
      ...(normalizeOptionalString(args.ipAddress)
        ? { ipAddress: normalizeOptionalString(args.ipAddress) }
        : {}),
      ...(normalizeOptionalString(args.userAgent)
        ? { userAgent: normalizeOptionalString(args.userAgent) }
        : {}),
    });
  },
});

export const getAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    eventType: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await getCurrentAuthUserOrNull(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const currentUserId = assertUserId(authUser, 'Better Auth user missing id');
    const isSiteAdmin = deriveIsSiteAdmin(normalizeUserRole(authUser.role));
    const requestedUserId = normalizeOptionalString(args.userId);
    const requestedIdentifier = normalizeAuditIdentifier(args.identifier);
    const currentIdentifier = normalizeAuditIdentifier(
      typeof authUser.email === 'string' ? authUser.email : undefined,
    );

    if (args.eventType && !isAuthAuditEventType(args.eventType)) {
      throw new Error(`Unsupported audit event type: ${args.eventType}`);
    }

    if (!isSiteAdmin && requestedUserId && requestedUserId !== currentUserId) {
      throwConvexError('FORBIDDEN', 'You can only query your own audit logs');
    }

    if (!isSiteAdmin && requestedIdentifier && requestedIdentifier !== currentIdentifier) {
      throwConvexError('FORBIDDEN', 'You can only query your own audit logs');
    }

    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const offset = Math.max(0, args.offset ?? 0);
    const organizationId = normalizeOptionalString(args.organizationId);

    const logs = isSiteAdmin
      ? await collectAuditLogsForAdmin(ctx, {
          eventType: args.eventType,
          identifier: requestedIdentifier,
          organizationId,
          userId: requestedUserId,
        })
      : await collectAuditLogsForUser(ctx, currentUserId, currentIdentifier);

    const events = dedupeEvents(
      logs
        .map((log) => toAuditEvent(log))
        .filter((event): event is AuthAuditEvent => event !== null),
    )
      .filter((event) => {
        if (!isSiteAdmin) {
          const matchesUserId = event.userId === currentUserId;
          const matchesIdentifier = currentIdentifier
            ? event.identifier === currentIdentifier
            : false;

          if (!matchesUserId && !matchesIdentifier) {
            return false;
          }
        }

        if (requestedUserId && event.userId !== requestedUserId) {
          return false;
        }

        if (args.eventType && event.eventType !== args.eventType) {
          return false;
        }

        if (organizationId && event.organizationId !== organizationId) {
          return false;
        }

        if (requestedIdentifier && event.identifier !== requestedIdentifier) {
          return false;
        }

        return true;
      })
      .sort(compareByCreatedAtDesc);

    return {
      events: events.slice(offset, offset + limit),
      total: events.length,
      limit,
      offset,
    };
  },
});
