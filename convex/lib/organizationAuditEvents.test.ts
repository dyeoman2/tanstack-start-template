import { describe, expect, it } from 'vitest';
import { getOrganizationAuditEventLabel } from './organizationAuditEvents';

describe('organization audit event labels', () => {
  it('labels enterprise break-glass usage for audit rendering', () => {
    expect(getOrganizationAuditEventLabel('enterprise_break_glass_used')).toBe(
      'Enterprise break-glass used',
    );
  });
});
