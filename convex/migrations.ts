import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { isAuthAuditEventType, normalizeAuditIdentifier } from '../src/lib/shared/auth-audit';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { type ActionCtx, action, internalMutation } from './_generated/server';
import { authComponent } from './auth';
import { throwConvexError } from './auth/errors';

const USER_PROFILES_BACKFILL_BATCH_SIZE = 100;
const AUDIT_LOGS_BACKFILL_BATCH_SIZE = 100;
type LegacyAuditLogDoc = Doc<'auditLogs'> & {
  action?: string;
  actorUserId?: string;
  entityId?: string;
  entityType?: string;
  source?: string;
  targetUserId?: string;
};

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function fromLegacyAuditAction(action: string | undefined) {
  switch (action) {
    case 'SIGNUP':
      return 'user_signed_up';
    case 'SIGNIN':
      return 'user_signed_in';
    case 'SIGNOUT':
      return 'user_signed_out';
    default:
      return undefined;
  }
}

function parseAuditMetadata(
  metadata: string | undefined,
): Record<string, unknown> | string | undefined {
  if (!metadata) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : metadata;
  } catch {
    return metadata;
  }
}

function stringifyAuditMetadata(metadata: Record<string, unknown> | string | undefined) {
  if (!metadata) {
    return undefined;
  }

  if (typeof metadata === 'string') {
    const trimmed = metadata.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return JSON.stringify(Object.fromEntries(entries));
}

async function requireSiteAdmin(ctx: ActionCtx) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  if (!deriveIsSiteAdmin(normalizeUserRole((authUser as { role?: string | string[] }).role))) {
    throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
  }
}

export const backfillUserProfilesIsSiteAdminBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('userProfiles').paginate({
      cursor: args.cursor ?? null,
      numItems: USER_PROFILES_BACKFILL_BATCH_SIZE,
    });

    let updated = 0;

    for (const profile of result.page) {
      const nextIsSiteAdmin = deriveIsSiteAdmin(normalizeUserRole(profile.role));
      if (profile.isSiteAdmin === nextIsSiteAdmin) {
        continue;
      }

      await ctx.db.patch(profile._id, {
        isSiteAdmin: nextIsSiteAdmin,
      });
      updated += 1;
    }

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      updated,
    };
  },
});

export const runUserProfilesIsSiteAdminBackfill = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);

    let batches = 0;
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runMutation(
        internal.migrations.backfillUserProfilesIsSiteAdminBatch,
        {
          cursor,
        },
      );

      batches += 1;
      processed += result.processed;
      updated += result.updated;

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
    };
  },
});

export const normalizeAuditLogsBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    updated: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('auditLogs').paginate({
      cursor: args.cursor ?? null,
      numItems: AUDIT_LOGS_BACKFILL_BATCH_SIZE,
    });

    let skipped = 0;
    let updated = 0;

    for (const rawAuditLog of result.page) {
      const auditLog = rawAuditLog as LegacyAuditLogDoc;
      const normalizedEventType = isAuthAuditEventType(auditLog.eventType)
        ? auditLog.eventType
        : isAuthAuditEventType(auditLog.action ?? '')
          ? auditLog.action
          : fromLegacyAuditAction(auditLog.action);

      if (!normalizedEventType) {
        skipped += 1;
        continue;
      }

      const normalizedUserIdCandidate =
        normalizeOptionalString(auditLog.userId) ??
        normalizeOptionalString(auditLog.targetUserId) ??
        normalizeOptionalString(auditLog.actorUserId);
      const normalizedUserId =
        normalizedUserIdCandidate && normalizedUserIdCandidate !== 'system'
          ? normalizedUserIdCandidate
          : undefined;

      const metadataExtras: Record<string, unknown> = {};
      if (normalizeOptionalString(auditLog.entityId)) {
        metadataExtras.entityId = normalizeOptionalString(auditLog.entityId);
      }
      if (
        normalizeOptionalString(auditLog.actorUserId) &&
        auditLog.actorUserId !== normalizedUserId
      ) {
        metadataExtras.actorUserId = auditLog.actorUserId;
      }
      if (
        normalizeOptionalString(auditLog.targetUserId) &&
        auditLog.targetUserId !== normalizedUserId
      ) {
        metadataExtras.targetUserId = auditLog.targetUserId;
      }

      const parsedMetadata = parseAuditMetadata(auditLog.metadata);
      const normalizedMetadata =
        typeof parsedMetadata === 'string'
          ? Object.keys(metadataExtras).length > 0
            ? { value: parsedMetadata, ...metadataExtras }
            : parsedMetadata
          : parsedMetadata
            ? { ...parsedMetadata, ...metadataExtras }
            : Object.keys(metadataExtras).length > 0
              ? metadataExtras
              : undefined;

      await ctx.db.replace(auditLog._id, {
        id: auditLog.id,
        eventType: normalizedEventType,
        ...(normalizedUserId ? { userId: normalizedUserId } : {}),
        ...(normalizeOptionalString(auditLog.organizationId)
          ? { organizationId: normalizeOptionalString(auditLog.organizationId) }
          : {}),
        ...(normalizeAuditIdentifier(auditLog.identifier)
          ? { identifier: normalizeAuditIdentifier(auditLog.identifier) }
          : {}),
        ...(stringifyAuditMetadata(normalizedMetadata)
          ? { metadata: stringifyAuditMetadata(normalizedMetadata) }
          : {}),
        createdAt: auditLog.createdAt,
        ...(normalizeOptionalString(auditLog.ipAddress)
          ? { ipAddress: normalizeOptionalString(auditLog.ipAddress) }
          : {}),
        ...(normalizeOptionalString(auditLog.userAgent)
          ? { userAgent: normalizeOptionalString(auditLog.userAgent) }
          : {}),
      });
      updated += 1;
    }

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      updated,
      skipped,
    };
  },
});

export const runAuditLogsNormalization = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);

    let batches = 0;
    let processed = 0;
    let skipped = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runMutation(anyApi.migrations.normalizeAuditLogsBatch, {
        cursor,
      });

      batches += 1;
      processed += result.processed;
      updated += result.updated;
      skipped += result.skipped;

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
      skipped,
    };
  },
});
