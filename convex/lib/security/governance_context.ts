import type { QueryCtx } from '../../_generated/server';
import { listSecurityPolicyReviewContextRecords } from './policies_core';

type SecurityGovernanceObjectType = 'control' | 'finding' | 'policy' | 'vendor_review';
type SecuritySupport = 'missing' | 'partial' | 'complete';

type SecurityGovernanceObjectSummary = {
  id: string;
  sourcePath?: string;
  support?: SecuritySupport;
  title: string;
  type: SecurityGovernanceObjectType;
};

type SecurityPolicyGovernanceContext = {
  controls: Array<{
    familyId: string;
    familyTitle: string;
    implementationSummary: string;
    internalControlId: string;
    isPrimary: boolean;
    nist80053Id: string;
    responsibility: 'customer' | 'platform' | 'shared-responsibility' | null;
    support: SecuritySupport;
    title: string;
  }>;
  policy: SecurityGovernanceObjectSummary & {
    policyId: string;
    sourcePath: string;
    support: SecuritySupport;
    type: 'policy';
  };
};

function buildPolicyGovernanceObjectSummary(
  policy: Awaited<ReturnType<typeof listSecurityPolicyReviewContextRecords>>[number]['policy'],
): SecurityPolicyGovernanceContext['policy'] {
  return {
    id: policy.policyId,
    policyId: policy.policyId,
    sourcePath: policy.sourcePath,
    support: policy.support,
    title: policy.title,
    type: 'policy',
  };
}

async function listSecurityPolicyGovernanceContexts(
  ctx: QueryCtx,
): Promise<SecurityPolicyGovernanceContext[]> {
  const reviewContexts = await listSecurityPolicyReviewContextRecords(ctx);
  return reviewContexts.map((context) => ({
    controls: context.policyControls,
    policy: buildPolicyGovernanceObjectSummary(context.policy),
  }));
}

export { buildPolicyGovernanceObjectSummary, listSecurityPolicyGovernanceContexts };
export type {
  SecurityGovernanceObjectSummary,
  SecurityGovernanceObjectType,
  SecurityPolicyGovernanceContext,
};
