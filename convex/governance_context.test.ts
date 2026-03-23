import { describe, expect, it } from 'vitest';
import { buildPolicyGovernanceObjectSummary } from './lib/security/governance_context';

describe('governance context contracts', () => {
  it('builds a policy governance summary without changing support semantics', () => {
    expect(
      buildPolicyGovernanceObjectSummary({
        policyId: 'access-control',
        sourcePath: 'docs/security-policies/access-control-policy.md',
        support: 'partial',
        title: 'Access Control Policy',
      }),
    ).toEqual({
      id: 'access-control',
      policyId: 'access-control',
      sourcePath: 'docs/security-policies/access-control-policy.md',
      support: 'partial',
      title: 'Access Control Policy',
      type: 'policy',
    });
  });
});
