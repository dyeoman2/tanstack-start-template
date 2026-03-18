import { v } from 'convex/values';
import type { QueryCtx } from './_generated/server';
import { internalQuery } from './_generated/server';

async function hasSecurityEvidenceRecord(
  ctx: QueryCtx,
  args: { internalControlId: string; itemId: string; storageId: string },
) {
  const evidence = await ctx.db
    .query('securityControlEvidence')
    .withIndex('by_internal_control_id_and_item_id', (q) =>
      q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
    )
    .collect();

  return evidence.some((record) => record.storageId === args.storageId);
}

export const listStaleEvidenceUploadsInternal = internalQuery({
  args: {
    cutoff: v.number(),
  },
  returns: v.array(
    v.object({
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query('storageLifecycle')
      .withIndex('by_source', (q) => q.eq('sourceType', 'security_control_evidence'))
      .collect();

    const staleUploads: Array<{ storageId: string }> = [];

    for (const candidate of candidates) {
      if (candidate.deletedAt || candidate.createdAt > args.cutoff) {
        continue;
      }

      const [internalControlId, itemId] = candidate.sourceId.split(':');
      if (!internalControlId || !itemId) {
        staleUploads.push({ storageId: candidate.storageId });
        continue;
      }

      const exists = await hasSecurityEvidenceRecord(ctx, {
        internalControlId,
        itemId,
        storageId: candidate.storageId,
      });
      if (!exists) {
        staleUploads.push({ storageId: candidate.storageId });
      }
    }

    return staleUploads;
  },
});
