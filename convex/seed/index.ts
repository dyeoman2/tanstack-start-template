import { v } from 'convex/values';
import { getE2ETestSecret } from '../../src/lib/server/env.server';
import { ACTIVE_CONTROL_REGISTER } from '../../src/lib/shared/compliance/control-register';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

const securityWorkspaceResetSummaryValidator = v.object({
  activeSeedControlCount: v.number(),
  deletedChecklistItems: v.number(),
  deletedEvidence: v.number(),
  deletedEvidenceActivity: v.number(),
  deletedEvidenceReports: v.number(),
  deletedExportArtifacts: v.number(),
  deletedPolicies: v.number(),
  deletedPolicyControlMappings: v.number(),
});

type SecurityWorkspaceResetSummary = {
  activeSeedControlCount: number;
  deletedChecklistItems: number;
  deletedEvidence: number;
  deletedEvidenceActivity: number;
  deletedEvidenceReports: number;
  deletedExportArtifacts: number;
  deletedPolicies: number;
  deletedPolicyControlMappings: number;
};

type SeedResult = {
  dryRun: boolean;
  generatedAt: string;
  generatedControlCount: number;
  notes: string[];
  reseedSecurityWorkspace: boolean;
  securityWorkspaceResetSummary: SecurityWorkspaceResetSummary | null;
};

export const seed = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    reseedSecurityWorkspace: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    generatedAt: v.string(),
    generatedControlCount: v.number(),
    notes: v.array(v.string()),
    reseedSecurityWorkspace: v.boolean(),
    securityWorkspaceResetSummary: v.union(securityWorkspaceResetSummaryValidator, v.null()),
  }),
  handler: async (ctx, args): Promise<SeedResult> => {
    const dryRun = args.dryRun ?? false;
    const reseedSecurityWorkspace = args.reseedSecurityWorkspace ?? false;
    const notes = [
      'Active control register seed data is file-backed and loaded from compliance/generated/active-control-register.seed.json.',
      'This seed entrypoint does not insert duplicate seeded evidence rows into Convex.',
    ];

    let securityWorkspaceResetSummary: SecurityWorkspaceResetSummary | null = null;

    if (reseedSecurityWorkspace) {
      if (dryRun) {
        notes.push('Dry run enabled: the security control workspace reset was skipped.');
      } else {
        securityWorkspaceResetSummary = await ctx.runMutation(
          internal.securityOps.reseedSecurityControlWorkspaceForDevelopment,
          {
            secret: getE2ETestSecret(),
          },
        );
        notes.push(
          'Security control workspace overrides were cleared so the seeded control register is the active source of truth again.',
        );
      }
    }

    if (dryRun) {
      notes.push('Dry run enabled: policy metadata sync from repo markdown was skipped.');
    } else {
      await ctx.runAction(internal.securityPoliciesNode.syncSecurityPoliciesFromSeedInternal, {
        actorUserId: 'system:seed',
      });
      notes.push(
        'Security policy metadata and control mappings were synced from repo-backed markdown.',
      );
    }

    return {
      dryRun,
      generatedAt: ACTIVE_CONTROL_REGISTER.generatedAt,
      generatedControlCount: ACTIVE_CONTROL_REGISTER.controls.length,
      notes,
      reseedSecurityWorkspace,
      securityWorkspaceResetSummary,
    };
  },
});
