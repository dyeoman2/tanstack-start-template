import { describe, expect, it } from 'vitest';
import { validateRegulatedAuditFields } from './audit';

describe('regulated audit validation', () => {
  it('accepts privileged events with complete manifest-linked metadata', () => {
    expect(() =>
      validateRegulatedAuditFields({
        actorUserId: 'admin-user',
        eventType: 'audit_log_exported',
        provenance: {
          actorUserId: 'admin-user',
          emitter: 'test',
          kind: 'site_admin',
        },
        metadata: JSON.stringify({
          exportHash: 'payload-hash',
          exportId: 'export-1',
          filters: { preset: 'all' },
          manifestHash: 'manifest-hash',
          rowCount: 10,
          scope: 'org-1',
        }),
        organizationId: 'org-1',
        outcome: 'success',
        resourceId: 'org-1-audit',
        resourceType: 'audit_export',
        severity: 'info',
        sourceSurface: 'organization.audit_export',
      }),
    ).not.toThrow();
  });

  it('fails closed when export metadata is incomplete', () => {
    expect(() =>
      validateRegulatedAuditFields({
        actorUserId: 'admin-user',
        eventType: 'audit_log_exported',
        provenance: {
          actorUserId: 'admin-user',
          emitter: 'test',
          kind: 'site_admin',
        },
        metadata: JSON.stringify({
          exportHash: 'payload-hash',
          rowCount: 10,
        }),
        organizationId: 'org-1',
        outcome: 'success',
        resourceId: 'org-1-audit',
        resourceType: 'audit_export',
        severity: 'info',
        sourceSurface: 'organization.audit_export',
      }),
    ).toThrow(/exportId|manifestHash/);
  });

  it('fails denied events that omit permission or reason metadata', () => {
    expect(() =>
      validateRegulatedAuditFields({
        actorUserId: 'user-1',
        eventType: 'authorization_denied',
        provenance: {
          actorUserId: 'user-1',
          emitter: 'test',
          kind: 'user',
        },
        metadata: JSON.stringify({
          permission: 'viewAudit',
        }),
        outcome: 'failure',
        resourceId: 'org-1',
        resourceType: 'organization_permission',
        severity: 'warning',
        sourceSurface: 'auth.authorization',
      }),
    ).toThrow(/reason/);
  });
});
