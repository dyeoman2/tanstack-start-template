import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

const pdfParseJobStatusValidator = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('ready'),
  v.literal('failed'),
  v.literal('quarantined'),
);

export const getPdfParseJobByStorageIdInternal = internalQuery({
  args: {
    storageId: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('pdfParseJobs')
      .withIndex('by_storageId', (query) => query.eq('storageId', args.storageId))
      .unique();
  },
});

export const upsertPdfParseJobInternal = internalMutation({
  args: {
    completedAt: v.optional(v.union(v.number(), v.null())),
    dispatchAttempts: v.optional(v.number()),
    dispatchErrorMessage: v.optional(v.union(v.string(), v.null())),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    organizationId: v.string(),
    parserVersion: v.optional(v.union(v.string(), v.null())),
    processingStartedAt: v.optional(v.union(v.number(), v.null())),
    purgeEligibleAt: v.optional(v.union(v.number(), v.null())),
    requestedByUserId: v.string(),
    resultStorageId: v.optional(v.union(v.string(), v.null())),
    status: pdfParseJobStatusValidator,
    storageId: v.string(),
    updatedAt: v.number(),
  },
  returns: v.id('pdfParseJobs'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('pdfParseJobs')
      .withIndex('by_storageId', (query) => query.eq('storageId', args.storageId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        completedAt: args.completedAt ?? existing.completedAt,
        dispatchAttempts: args.dispatchAttempts ?? existing.dispatchAttempts,
        dispatchErrorMessage: args.dispatchErrorMessage ?? undefined,
        errorMessage: args.errorMessage ?? undefined,
        organizationId: args.organizationId,
        parserVersion: args.parserVersion ?? existing.parserVersion,
        processingStartedAt: args.processingStartedAt ?? existing.processingStartedAt,
        purgeEligibleAt: args.purgeEligibleAt ?? existing.purgeEligibleAt,
        requestedByUserId: args.requestedByUserId,
        resultStorageId: args.resultStorageId ?? existing.resultStorageId,
        status: args.status,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert('pdfParseJobs', {
      completedAt: args.completedAt ?? undefined,
      createdAt: args.updatedAt,
      dispatchAttempts: args.dispatchAttempts ?? 0,
      dispatchErrorMessage: args.dispatchErrorMessage ?? undefined,
      errorMessage: args.errorMessage ?? undefined,
      organizationId: args.organizationId,
      parserVersion: args.parserVersion ?? undefined,
      processingStartedAt: args.processingStartedAt ?? undefined,
      purgeEligibleAt: args.purgeEligibleAt ?? undefined,
      requestedByUserId: args.requestedByUserId,
      resultStorageId: args.resultStorageId ?? undefined,
      status: args.status,
      storageId: args.storageId,
      updatedAt: args.updatedAt,
    });
  },
});
