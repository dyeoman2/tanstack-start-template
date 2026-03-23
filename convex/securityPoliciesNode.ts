'use node';

import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { v } from 'convex/values';
import { hashContent } from './lib/security/core';
import { SECURITY_POLICY_CATALOG } from '../src/lib/shared/compliance/security-policies';
import { SECURITY_POLICY_DOCUMENTS } from '../src/lib/shared/compliance/security-policy-documents';

async function readSeedPolicyCatalogFromRepo() {
  return await Promise.all(
    SECURITY_POLICY_CATALOG.map(async (policy) => {
      const content = SECURITY_POLICY_DOCUMENTS[policy.sourcePath];
      if (typeof content !== 'string') {
        throw new Error(`Missing bundled policy document for ${policy.sourcePath}`);
      }
      return {
        ...policy,
        contentHash: await hashContent(content),
      };
    }),
  );
}

export const syncSecurityPoliciesFromSeedInternal = internalAction({
  args: {
    actorUserId: v.string(),
  },
  returns: v.object({
    mappingCount: v.number(),
    policyCount: v.number(),
    syncedAt: v.number(),
    syncedByUserId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    mappingCount: number;
    policyCount: number;
    syncedAt: number;
    syncedByUserId: string;
  }> => {
    const catalog = await readSeedPolicyCatalogFromRepo();
    return await ctx.runMutation(internal.securityPolicies.syncSecurityPoliciesCatalogInternal, {
      actorUserId: args.actorUserId,
      catalog,
    });
  },
});
