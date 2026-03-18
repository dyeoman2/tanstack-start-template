import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from './_generated/server';
import {
  malwareStatusValidator,
  mirrorStatusValidator,
  quarantineReasonValidator,
  storageBackendModeValidator,
} from './storageTypes';

type LifecycleCtx = MutationCtx | QueryCtx;
type StorageLifecycleDoc = Doc<'storageLifecycle'>;

const lifecyclePatchValidator = v.object({
  backendMode: v.optional(storageBackendModeValidator),
  canonicalBucket: v.optional(v.union(v.string(), v.null())),
  canonicalKey: v.optional(v.union(v.string(), v.null())),
  canonicalVersionId: v.optional(v.union(v.string(), v.null())),
  deletedAt: v.optional(v.union(v.number(), v.null())),
  fileSize: v.optional(v.union(v.number(), v.null())),
  malwareDetectedAt: v.optional(v.union(v.number(), v.null())),
  malwareFindingId: v.optional(v.union(v.string(), v.null())),
  malwareScannedAt: v.optional(v.union(v.number(), v.null())),
  malwareStatus: v.optional(v.union(malwareStatusValidator, v.null())),
  mimeType: v.optional(v.union(v.string(), v.null())),
  mirrorAttempts: v.optional(v.union(v.number(), v.null())),
  mirrorBucket: v.optional(v.union(v.string(), v.null())),
  mirrorDeadlineAt: v.optional(v.union(v.number(), v.null())),
  mirrorKey: v.optional(v.union(v.string(), v.null())),
  mirrorLastError: v.optional(v.union(v.string(), v.null())),
  mirrorStatus: v.optional(v.union(mirrorStatusValidator, v.null())),
  mirrorVersionId: v.optional(v.union(v.string(), v.null())),
  originalFileName: v.optional(v.string()),
  quarantinedAt: v.optional(v.union(v.number(), v.null())),
  quarantineReason: v.optional(v.union(quarantineReasonValidator, v.null())),
  sourceId: v.optional(v.string()),
  sourceType: v.optional(v.string()),
  uploadedById: v.optional(v.union(v.id('users'), v.null())),
  updatedAt: v.number(),
});

const lifecycleEventArgs = {
  actionResult: v.union(v.literal('success'), v.literal('failure')),
  actorUserId: v.optional(v.id('users')),
  details: v.optional(v.string()),
  eventType: v.string(),
  storageId: v.string(),
};

function nullableToOptional<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

export async function getLifecycleByStorageId(
  ctx: LifecycleCtx,
  storageId: string,
): Promise<StorageLifecycleDoc | null> {
  return await ctx.db
    .query('storageLifecycle')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .unique();
}

export async function getLifecycleBySource(
  ctx: LifecycleCtx,
  sourceType: string,
  sourceId: string,
): Promise<StorageLifecycleDoc | null> {
  return await ctx.db
    .query('storageLifecycle')
    .withIndex('by_source', (q) => q.eq('sourceType', sourceType).eq('sourceId', sourceId))
    .unique();
}

export async function getLifecycleByS3Key(
  ctx: LifecycleCtx,
  bucket: string,
  key: string,
): Promise<StorageLifecycleDoc | null> {
  return await ctx.db
    .query('storageLifecycle')
    .withIndex('by_s3Key', (q) => q.eq('canonicalBucket', bucket).eq('canonicalKey', key))
    .unique();
}

export async function appendLifecycleEvent(
  ctx: MutationCtx,
  args: {
    actionResult: 'success' | 'failure';
    actorUserId?: Id<'users'>;
    details?: string;
    eventType: string;
    storageId: string;
  },
) {
  const lifecycle = await getLifecycleByStorageId(ctx, args.storageId);
  if (!lifecycle) {
    throw new ConvexError(`Lifecycle row not found for storageId=${args.storageId}.`);
  }

  return await ctx.db.insert('storageLifecycleEvents', {
    actionResult: args.actionResult,
    actorUserId: args.actorUserId,
    createdAt: Date.now(),
    details: args.details,
    eventType: args.eventType,
    sourceId: lifecycle.sourceId,
    sourceType: lifecycle.sourceType,
    storageId: args.storageId,
    storageLifecycleId: lifecycle._id,
  });
}

export async function upsertLifecycle(
  ctx: MutationCtx,
  args: {
    backendMode: StorageLifecycleDoc['backendMode'];
    canonicalBucket?: string;
    canonicalKey?: string;
    canonicalVersionId?: string;
    fileSize?: number;
    malwareStatus?: StorageLifecycleDoc['malwareStatus'];
    mimeType?: string;
    mirrorBucket?: string;
    mirrorDeadlineAt?: number;
    mirrorKey?: string;
    mirrorStatus?: StorageLifecycleDoc['mirrorStatus'];
    mirrorVersionId?: string;
    originalFileName: string;
    sourceId: string;
    sourceType: string;
    storageId: string;
    uploadedById?: Id<'users'>;
  },
) {
  const existing = await getLifecycleByStorageId(ctx, args.storageId);
  const now = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, {
      backendMode: args.backendMode,
      canonicalBucket: args.canonicalBucket ?? existing.canonicalBucket,
      canonicalKey: args.canonicalKey ?? existing.canonicalKey,
      canonicalVersionId: args.canonicalVersionId ?? existing.canonicalVersionId,
      fileSize: args.fileSize ?? existing.fileSize,
      malwareStatus: args.malwareStatus ?? existing.malwareStatus,
      mimeType: args.mimeType ?? existing.mimeType,
      mirrorBucket: args.mirrorBucket ?? existing.mirrorBucket,
      mirrorDeadlineAt: args.mirrorDeadlineAt ?? existing.mirrorDeadlineAt,
      mirrorKey: args.mirrorKey ?? existing.mirrorKey,
      mirrorStatus: args.mirrorStatus ?? existing.mirrorStatus,
      mirrorVersionId: args.mirrorVersionId ?? existing.mirrorVersionId,
      originalFileName: args.originalFileName,
      sourceId: args.sourceId,
      sourceType: args.sourceType,
      updatedAt: now,
      uploadedById: args.uploadedById ?? existing.uploadedById,
    });
    return existing._id;
  }

  return await ctx.db.insert('storageLifecycle', {
    backendMode: args.backendMode,
    canonicalBucket: args.canonicalBucket,
    canonicalKey: args.canonicalKey,
    canonicalVersionId: args.canonicalVersionId,
    createdAt: now,
    deletedAt: undefined,
    fileSize: args.fileSize,
    malwareStatus: args.malwareStatus,
    mimeType: args.mimeType,
    mirrorAttempts: undefined,
    mirrorBucket: args.mirrorBucket,
    mirrorDeadlineAt: args.mirrorDeadlineAt,
    mirrorKey: args.mirrorKey,
    mirrorLastError: undefined,
    mirrorStatus: args.mirrorStatus,
    mirrorVersionId: args.mirrorVersionId,
    originalFileName: args.originalFileName,
    quarantinedAt: undefined,
    quarantineReason: undefined,
    sourceId: args.sourceId,
    sourceType: args.sourceType,
    storageId: args.storageId,
    updatedAt: now,
    uploadedById: args.uploadedById,
  });
}

async function applyLifecyclePatch(
  ctx: MutationCtx,
  args: {
    patch: {
      backendMode?: StorageLifecycleDoc['backendMode'];
      canonicalBucket?: string | null;
      canonicalKey?: string | null;
      canonicalVersionId?: string | null;
      deletedAt?: number | null;
      fileSize?: number | null;
      malwareDetectedAt?: number | null;
      malwareFindingId?: string | null;
      malwareScannedAt?: number | null;
      malwareStatus?: StorageLifecycleDoc['malwareStatus'] | null;
      mimeType?: string | null;
      mirrorAttempts?: number | null;
      mirrorBucket?: string | null;
      mirrorDeadlineAt?: number | null;
      mirrorKey?: string | null;
      mirrorLastError?: string | null;
      mirrorStatus?: StorageLifecycleDoc['mirrorStatus'] | null;
      mirrorVersionId?: string | null;
      originalFileName?: string;
      quarantinedAt?: number | null;
      quarantineReason?: StorageLifecycleDoc['quarantineReason'] | null;
      sourceId?: string;
      sourceType?: string;
      updatedAt: number;
      uploadedById?: Id<'users'> | null;
    };
    storageId: string;
  },
) {
  const lifecycle = await getLifecycleByStorageId(ctx, args.storageId);
  if (!lifecycle) {
    throw new ConvexError(`Lifecycle row not found for storageId=${args.storageId}.`);
  }

  await ctx.db.patch(lifecycle._id, {
    backendMode: args.patch.backendMode ?? lifecycle.backendMode,
    canonicalBucket:
      args.patch.canonicalBucket !== undefined
        ? nullableToOptional(args.patch.canonicalBucket)
        : lifecycle.canonicalBucket,
    canonicalKey:
      args.patch.canonicalKey !== undefined
        ? nullableToOptional(args.patch.canonicalKey)
        : lifecycle.canonicalKey,
    canonicalVersionId:
      args.patch.canonicalVersionId !== undefined
        ? nullableToOptional(args.patch.canonicalVersionId)
        : lifecycle.canonicalVersionId,
    deletedAt:
      args.patch.deletedAt !== undefined
        ? nullableToOptional(args.patch.deletedAt)
        : lifecycle.deletedAt,
    fileSize:
      args.patch.fileSize !== undefined
        ? nullableToOptional(args.patch.fileSize)
        : lifecycle.fileSize,
    malwareDetectedAt:
      args.patch.malwareDetectedAt !== undefined
        ? nullableToOptional(args.patch.malwareDetectedAt)
        : lifecycle.malwareDetectedAt,
    malwareFindingId:
      args.patch.malwareFindingId !== undefined
        ? nullableToOptional(args.patch.malwareFindingId)
        : lifecycle.malwareFindingId,
    malwareScannedAt:
      args.patch.malwareScannedAt !== undefined
        ? nullableToOptional(args.patch.malwareScannedAt)
        : lifecycle.malwareScannedAt,
    malwareStatus:
      args.patch.malwareStatus !== undefined
        ? nullableToOptional(args.patch.malwareStatus)
        : lifecycle.malwareStatus,
    mimeType:
      args.patch.mimeType !== undefined
        ? nullableToOptional(args.patch.mimeType)
        : lifecycle.mimeType,
    mirrorAttempts:
      args.patch.mirrorAttempts !== undefined
        ? nullableToOptional(args.patch.mirrorAttempts)
        : lifecycle.mirrorAttempts,
    mirrorBucket:
      args.patch.mirrorBucket !== undefined
        ? nullableToOptional(args.patch.mirrorBucket)
        : lifecycle.mirrorBucket,
    mirrorDeadlineAt:
      args.patch.mirrorDeadlineAt !== undefined
        ? nullableToOptional(args.patch.mirrorDeadlineAt)
        : lifecycle.mirrorDeadlineAt,
    mirrorKey:
      args.patch.mirrorKey !== undefined
        ? nullableToOptional(args.patch.mirrorKey)
        : lifecycle.mirrorKey,
    mirrorLastError:
      args.patch.mirrorLastError !== undefined
        ? nullableToOptional(args.patch.mirrorLastError)
        : lifecycle.mirrorLastError,
    mirrorStatus:
      args.patch.mirrorStatus !== undefined
        ? nullableToOptional(args.patch.mirrorStatus)
        : lifecycle.mirrorStatus,
    mirrorVersionId:
      args.patch.mirrorVersionId !== undefined
        ? nullableToOptional(args.patch.mirrorVersionId)
        : lifecycle.mirrorVersionId,
    originalFileName: args.patch.originalFileName ?? lifecycle.originalFileName,
    quarantinedAt:
      args.patch.quarantinedAt !== undefined
        ? nullableToOptional(args.patch.quarantinedAt)
        : lifecycle.quarantinedAt,
    quarantineReason:
      args.patch.quarantineReason !== undefined
        ? nullableToOptional(args.patch.quarantineReason)
        : lifecycle.quarantineReason,
    sourceId: args.patch.sourceId ?? lifecycle.sourceId,
    sourceType: args.patch.sourceType ?? lifecycle.sourceType,
    updatedAt: args.patch.updatedAt,
    uploadedById:
      args.patch.uploadedById !== undefined
        ? nullableToOptional(args.patch.uploadedById)
        : lifecycle.uploadedById,
  });
}

export const getByStorageId = query({
  args: { storageId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await getLifecycleByStorageId(ctx, args.storageId);
  },
});

export const getByStorageIdInternal = internalQuery({
  args: { storageId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await getLifecycleByStorageId(ctx, args.storageId);
  },
});

export const getBySource = query({
  args: { sourceId: v.string(), sourceType: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await getLifecycleBySource(ctx, args.sourceType, args.sourceId);
  },
});

export const getByS3Key = internalQuery({
  args: { bucket: v.string(), key: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await getLifecycleByS3Key(ctx, args.bucket, args.key);
  },
});

export const listExpiredLifecycleByDeadlineInternal = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('storageLifecycle')
      .withIndex('by_mirrorDeadlineAt', (q) => q.lt('mirrorDeadlineAt', args.now))
      .collect();
  },
});

export const upsertLifecycleInternal = internalMutation({
  args: {
    backendMode: storageBackendModeValidator,
    canonicalBucket: v.optional(v.string()),
    canonicalKey: v.optional(v.string()),
    canonicalVersionId: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    malwareStatus: v.optional(malwareStatusValidator),
    mimeType: v.optional(v.string()),
    mirrorBucket: v.optional(v.string()),
    mirrorDeadlineAt: v.optional(v.number()),
    mirrorKey: v.optional(v.string()),
    mirrorStatus: v.optional(mirrorStatusValidator),
    mirrorVersionId: v.optional(v.string()),
    originalFileName: v.string(),
    sourceId: v.string(),
    sourceType: v.string(),
    storageId: v.string(),
    uploadedById: v.optional(v.id('users')),
  },
  returns: v.id('storageLifecycle'),
  handler: async (ctx, args) => {
    return await upsertLifecycle(ctx, args);
  },
});

export const patchLifecycleInternal = internalMutation({
  args: {
    patch: lifecyclePatchValidator,
    storageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyLifecyclePatch(ctx, args);
    return null;
  },
});

export const appendLifecycleEventInternal = internalMutation({
  args: lifecycleEventArgs,
  returns: v.id('storageLifecycleEvents'),
  handler: async (ctx, args) => {
    return await appendLifecycleEvent(ctx, args);
  },
});

export const markCleanInternal = internalMutation({
  args: { scannedAt: v.number(), storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyLifecyclePatch(ctx, {
      patch: {
        malwareDetectedAt: null,
        malwareFindingId: null,
        malwareScannedAt: args.scannedAt,
        malwareStatus: 'CLEAN',
        quarantinedAt: null,
        quarantineReason: null,
        updatedAt: Date.now(),
      },
      storageId: args.storageId,
    });
    await appendLifecycleEvent(ctx, {
      actionResult: 'success',
      eventType: 'malware_clean',
      storageId: args.storageId,
    });
    return null;
  },
});

export const markInfectedInternal = internalMutation({
  args: { findingId: v.string(), scannedAt: v.number(), storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await applyLifecyclePatch(ctx, {
      patch: {
        malwareDetectedAt: args.scannedAt,
        malwareFindingId: args.findingId,
        malwareScannedAt: args.scannedAt,
        malwareStatus: 'INFECTED',
        quarantinedAt: now,
        quarantineReason: 'INFECTED',
        updatedAt: now,
      },
      storageId: args.storageId,
    });
    await appendLifecycleEvent(ctx, {
      actionResult: 'failure',
      details: args.findingId,
      eventType: 'malware_infected',
      storageId: args.storageId,
    });
    return null;
  },
});

export const markDeadlineMissedInternal = internalMutation({
  args: { storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await applyLifecyclePatch(ctx, {
      patch: {
        malwareStatus: 'QUARANTINED_UNSCANNED',
        quarantinedAt: now,
        quarantineReason: 'QUARANTINED_UNSCANNED',
        updatedAt: now,
      },
      storageId: args.storageId,
    });
    await appendLifecycleEvent(ctx, {
      actionResult: 'failure',
      eventType: 'malware_deadline_missed',
      storageId: args.storageId,
    });
    return null;
  },
});

export const markDeletedInternal = internalMutation({
  args: { storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await applyLifecyclePatch(ctx, {
      patch: {
        deletedAt: now,
        updatedAt: now,
      },
      storageId: args.storageId,
    });
    await appendLifecycleEvent(ctx, {
      actionResult: 'success',
      eventType: 'deleted',
      storageId: args.storageId,
    });
    return null;
  },
});

export const markMirrorSuccessInternal = internalMutation({
  args: {
    bucket: v.string(),
    key: v.string(),
    storageId: v.string(),
    versionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await applyLifecyclePatch(ctx, {
      patch: {
        mirrorBucket: args.bucket,
        mirrorKey: args.key,
        mirrorLastError: null,
        mirrorStatus: 'MIRRORED',
        mirrorVersionId: args.versionId ?? null,
        updatedAt: Date.now(),
      },
      storageId: args.storageId,
    });
    await appendLifecycleEvent(ctx, {
      actionResult: 'success',
      eventType: 'mirror_success',
      storageId: args.storageId,
    });
    return null;
  },
});

export const markMirrorFailureInternal = internalMutation({
  args: {
    details: v.string(),
    nextAttemptAt: v.optional(v.number()),
    storageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lifecycle = await getLifecycleByStorageId(ctx, args.storageId);
    if (!lifecycle) {
      throw new ConvexError(`Lifecycle row not found for storageId=${args.storageId}.`);
    }
    await applyLifecyclePatch(ctx, {
      patch: {
        mirrorAttempts: (lifecycle.mirrorAttempts ?? 0) + 1,
        mirrorDeadlineAt: args.nextAttemptAt ?? lifecycle.mirrorDeadlineAt ?? null,
        mirrorLastError: args.details,
        mirrorStatus: 'FAILED',
        updatedAt: Date.now(),
      },
      storageId: args.storageId,
    });
    await appendLifecycleEvent(ctx, {
      actionResult: 'failure',
      details: args.details,
      eventType: 'mirror_failure',
      storageId: args.storageId,
    });
    return null;
  },
});
