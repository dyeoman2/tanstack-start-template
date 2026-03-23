import { describe, expect, it } from 'vitest';
import { formatPolicySupportProgress } from '~/features/security/formatters';
import type { SecurityPolicySummary } from '~/features/security/types';

function buildPolicySummary(overrides?: Partial<SecurityPolicySummary>): SecurityPolicySummary {
  return {
    contentHash: 'policy-hash-1',
    lastReviewedAt: null,
    linkedAnnualReviewTask: null,
    mappedControlCount: 4,
    mappedControlCountsBySupport: {
      complete: 3,
      missing: 0,
      partial: 1,
    },
    nextReviewAt: null,
    owner: 'Security team',
    policyId: 'audit-logging',
    scopeId: 'provider',
    scopeType: 'provider_global',
    sourcePath: 'docs/security-policies/audit-logging-policy.md',
    summary: 'Defines audit logging requirements.',
    support: 'partial',
    title: 'Audit Logging and Log Review Policy',
    ...overrides,
  };
}

describe('formatPolicySupportProgress', () => {
  it('counts only complete mapped controls in the completed numerator', () => {
    expect(formatPolicySupportProgress(buildPolicySummary())).toBe('3/4');
  });

  it('shows fully complete policies as fully counted', () => {
    expect(
      formatPolicySupportProgress(
        buildPolicySummary({
          mappedControlCount: 3,
          mappedControlCountsBySupport: {
            complete: 3,
            missing: 0,
            partial: 0,
          },
          support: 'complete',
        }),
      ),
    ).toBe('3/3');
  });
});
