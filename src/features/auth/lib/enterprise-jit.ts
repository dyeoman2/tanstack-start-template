export type EnterpriseJitMembershipStatus = 'active' | 'suspended' | 'deactivated' | null;

export function shouldCreateEnterpriseJitMembership(input: {
  existingMembership: boolean;
  membershipStateStatus: EnterpriseJitMembershipStatus;
}) {
  if (input.existingMembership) {
    return false;
  }

  return input.membershipStateStatus !== 'deactivated';
}
