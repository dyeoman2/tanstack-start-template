import type { QueryCtx } from '../_generated/server';

export async function listStandaloneAttachmentsForOrganization(
  ctx: Pick<QueryCtx, 'db'>,
  args: {
    organizationId: string;
    limit: number;
  },
) {
  return await ctx.db
    .query('chatAttachments')
    .withIndex('by_organizationId_and_threadId_and_createdAt', (q) =>
      q.eq('organizationId', args.organizationId).eq('threadId', undefined),
    )
    .order('asc')
    .take(args.limit);
}
