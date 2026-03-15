import { describe, expect, it } from 'vitest';
import { shouldCreateEnterpriseJitMembership } from './enterprise-jit';

describe('shouldCreateEnterpriseJitMembership', () => {
  it('creates membership for a first-time enterprise user', () => {
    expect(
      shouldCreateEnterpriseJitMembership({
        existingMembership: false,
        membershipStateStatus: null,
      }),
    ).toBe(true);
  });

  it('does not recreate an existing membership', () => {
    expect(
      shouldCreateEnterpriseJitMembership({
        existingMembership: true,
        membershipStateStatus: null,
      }),
    ).toBe(false);
  });

  it('blocks JIT reactivation for deactivated users', () => {
    expect(
      shouldCreateEnterpriseJitMembership({
        existingMembership: false,
        membershipStateStatus: 'deactivated',
      }),
    ).toBe(false);
  });

  it('allows suspended users to be reprovisioned through enterprise sign-in policy', () => {
    expect(
      shouldCreateEnterpriseJitMembership({
        existingMembership: false,
        membershipStateStatus: 'suspended',
      }),
    ).toBe(true);
  });
});
