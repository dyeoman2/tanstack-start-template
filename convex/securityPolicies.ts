import { internal } from './_generated/api';
import { internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';
import { siteAdminAction, siteAdminQuery } from './auth/authorized';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
} from './auth/access';
import {
  getSecurityPolicyDetailRecord,
  listSecurityPolicyExportRecords,
  listSecurityPolicySummaryRecords,
  syncSecurityPoliciesFromCatalog,
} from './lib/security/policies_core';
import {
  securityPolicyDetailValidator,
  securityPolicySummaryListValidator,
} from './lib/security/validators';

export const listSecurityPolicies = siteAdminQuery({
  args: {},
  returns: securityPolicySummaryListValidator,
  handler: async (ctx) => {
    return await listSecurityPolicySummaryRecords(ctx);
  },
});

export const getSecurityPolicyDetail = siteAdminQuery({
  args: {
    policyId: v.string(),
  },
  returns: v.union(securityPolicyDetailValidator, v.null()),
  handler: async (ctx, args) => {
    return await getSecurityPolicyDetailRecord(ctx, args.policyId);
  },
});

export const listSecurityPolicyExports = query({
  args: {},
  returns: securityPolicySummaryListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityPolicyExportRecords(ctx);
  },
});

export const listSecurityPolicyExportsInternal = internalQuery({
  args: {},
  returns: securityPolicySummaryListValidator,
  handler: async (ctx) => {
    return await listSecurityPolicyExportRecords(ctx);
  },
});

export const syncSecurityPoliciesCatalogInternal = internalMutation({
  args: {
    actorUserId: v.string(),
    catalog: v.array(
      v.object({
        contentHash: v.string(),
        mappings: v.array(
          v.object({
            internalControlId: v.string(),
            isPrimary: v.boolean(),
          }),
        ),
        owner: v.string(),
        policyId: v.string(),
        sourcePath: v.string(),
        summary: v.string(),
        title: v.string(),
      }),
    ),
  },
  returns: v.object({
    mappingCount: v.number(),
    policyCount: v.number(),
    syncedAt: v.number(),
    syncedByUserId: v.string(),
  }),
  handler: async (ctx, args) => {
    return await syncSecurityPoliciesFromCatalog(ctx, args);
  },
});

export const syncSecurityPoliciesFromSeed = siteAdminAction({
  args: {},
  returns: v.object({
    mappingCount: v.number(),
    policyCount: v.number(),
    syncedAt: v.number(),
    syncedByUserId: v.string(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    mappingCount: number;
    policyCount: number;
    syncedAt: number;
    syncedByUserId: string;
  }> => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    return await ctx.runAction(internal.securityPoliciesNode.syncSecurityPoliciesFromSeedInternal, {
      actorUserId: currentUser.authUserId,
    });
  },
});
