import { describe, expect, it } from 'vitest';
import {
  doesSupportGrantCoverPermission,
  requiresEnterpriseSatisfied,
  resolveOrganizationEnterpriseAccess,
} from './enterpriseAccess';

function createCtx(overrides?: {
  grants?: Array<Record<string, unknown>>;
  verifiedDomains?: string[];
}) {
  return {
    db: {
      query(table: string) {
        return {
          withIndex(_indexName: string, _builder: unknown) {
            return {
              async collect() {
                if (table === 'organizationDomains') {
                  return (overrides?.verifiedDomains ?? []).map((domain) => ({
                    normalizedDomain: domain,
                    status: 'verified',
                  }));
                }

                if (table === 'organizationSupportAccessGrants') {
                  return overrides?.grants ?? [];
                }

                return [];
              },
            };
          },
        };
      },
    },
  } as never;
}

const basePolicies = {
  allowBreakGlassPasswordLogin: false,
  enterpriseAuthMode: 'required' as const,
  enterpriseProviderKey: 'google-workspace' as const,
};

const baseUser = {
  authSession: null,
  authUser: {
    email: 'clinician@hospital.org',
  },
  authUserId: 'user-1',
  isSiteAdmin: false,
};

describe('enterprise access', () => {
  it('marks data-plane permissions as enterprise-protected', () => {
    expect(requiresEnterpriseSatisfied('viewOrganization')).toBe(true);
    expect(requiresEnterpriseSatisfied('readThread')).toBe(true);
    expect(requiresEnterpriseSatisfied('issueAttachmentAccessUrl')).toBe(true);
    expect(requiresEnterpriseSatisfied('manageMembers')).toBe(true);
    expect(requiresEnterpriseSatisfied('manageEvidence')).toBe(true);
  });

  it('enforces enterprise session for managed-domain members on PHI reads', async () => {
    const result = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'member' },
        organizationId: 'org-1',
        permission: 'readThread',
        policies: basePolicies,
        user: baseUser,
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('missing_enterprise_session');
  });

  it('denies unmanaged email domains when SSO is required', async () => {
    const result = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'member' },
        organizationId: 'org-1',
        permission: 'readThread',
        policies: basePolicies,
        user: {
          ...baseUser,
          authUser: {
            email: 'consultant@outside.example',
          },
        },
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('unmanaged_email_domain');
  });

  it('does not let break-glass password satisfy PHI data-plane access', async () => {
    const result = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'readThread',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('missing_enterprise_session');
  });

  it('still allows owner break-glass on control-plane policy access', async () => {
    const result = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'managePolicies',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    expect(result.allowed).toBe(true);
    expect(result.satisfactionPath).toBe('owner_break_glass');
    expect(result.status).toBe('satisfied');
  });

  it('allows owner break-glass for organization entry and member administration', async () => {
    const viewResult = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'viewOrganization',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    const manageMembersResult = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'manageMembers',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    expect(viewResult.allowed).toBe(true);
    expect(viewResult.satisfactionPath).toBe('owner_break_glass');
    expect(manageMembersResult.allowed).toBe(true);
    expect(manageMembersResult.satisfactionPath).toBe('owner_break_glass');
  });

  it('blocks owner break-glass for audit, evidence, and PHI data plane access', async () => {
    const auditResult = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'viewAudit',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    const evidenceResult = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'manageEvidence',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    const dataPlaneResult = await resolveOrganizationEnterpriseAccess(
      createCtx({
        verifiedDomains: ['hospital.org'],
      }),
      {
        membership: { role: 'owner' },
        organizationId: 'org-1',
        permission: 'readAttachment',
        policies: {
          ...basePolicies,
          allowBreakGlassPasswordLogin: true,
        },
        user: baseUser,
      },
    );

    expect(auditResult.allowed).toBe(false);
    expect(auditResult.status).toBe('missing_enterprise_session');
    expect(auditResult.satisfactionPath).toBeNull();
    expect(evidenceResult.allowed).toBe(false);
    expect(evidenceResult.status).toBe('missing_enterprise_session');
    expect(dataPlaneResult.allowed).toBe(false);
    expect(dataPlaneResult.status).toBe('missing_enterprise_session');
  });

  it.each(['off', 'optional', 'required'] as const)(
    'requires a support grant for site-admin tenant access when enterpriseAuthMode=%s',
    async (enterpriseAuthMode) => {
      for (const permission of [
        'viewOrganization',
        'viewAudit',
        'exportAudit',
        'readThread',
        'writeThread',
        'readAttachment',
        'deleteAttachment',
        'issueAttachmentAccessUrl',
      ] as const) {
        const result = await resolveOrganizationEnterpriseAccess(createCtx(), {
          membership: null,
          organizationId: 'org-1',
          permission,
          policies: {
            ...basePolicies,
            enterpriseAuthMode,
          },
          user: {
            ...baseUser,
            authUserId: 'site-admin-1',
            isSiteAdmin: true,
          },
        });

        expect(result.allowed).toBe(false);
        expect(result.status).toBe('support_grant_required');
      }
    },
  );

  it.each(['off', 'optional', 'required'] as const)(
    'allows site-admin read access with an active read-only grant when enterpriseAuthMode=%s',
    async (enterpriseAuthMode) => {
      const now = Date.now();
      const result = await resolveOrganizationEnterpriseAccess(
        createCtx({
          grants: [
            {
              _id: 'grant-1',
              organizationId: 'org-1',
              siteAdminUserId: 'site-admin-1',
              scope: 'read_only',
              ticketId: 'INC-42',
              reason: 'Urgent support review',
              grantedByUserId: 'owner-1',
              createdAt: now,
              expiresAt: now + 60_000,
              revokedAt: null,
              revokedByUserId: null,
            },
          ],
        }),
        {
          membership: null,
          organizationId: 'org-1',
          permission: 'readThread',
          policies: {
            ...basePolicies,
            enterpriseAuthMode,
          },
          user: {
            ...baseUser,
            authUserId: 'site-admin-1',
            isSiteAdmin: true,
          },
        },
      );

      expect(result.allowed).toBe(true);
      expect(result.satisfactionPath).toBe('support_grant');
      expect(result.status).toBe('satisfied');
      expect(result.supportGrant?.id).toBe('grant-1');
      expect(result.supportGrant?.scope).toBe('read_only');
      expect(result.supportGrant?.ticketId).toBe('INC-42');
    },
  );

  it('does not let a read-only grant cover writes', async () => {
    expect(doesSupportGrantCoverPermission('read_only', 'viewOrganization')).toBe(true);
    expect(doesSupportGrantCoverPermission('read_only', 'exportAudit')).toBe(true);
    expect(doesSupportGrantCoverPermission('read_only', 'managePolicies')).toBe(false);
    expect(doesSupportGrantCoverPermission('read_only', 'readThread')).toBe(true);
    expect(doesSupportGrantCoverPermission('read_only', 'writeThread')).toBe(false);
  });

  it.each(['off', 'optional', 'required'] as const)(
    'allows site-admin write access only with a read-write grant when enterpriseAuthMode=%s',
    async (enterpriseAuthMode) => {
      const now = Date.now();
      const result = await resolveOrganizationEnterpriseAccess(
        createCtx({
          grants: [
            {
              _id: 'grant-1',
              organizationId: 'org-1',
              siteAdminUserId: 'site-admin-1',
              scope: 'read_write',
              ticketId: 'INC-99',
              reason: 'Escalated investigation',
              grantedByUserId: 'owner-1',
              createdAt: now,
              expiresAt: now + 60_000,
              revokedAt: null,
              revokedByUserId: null,
            },
          ],
        }),
        {
          membership: null,
          organizationId: 'org-1',
          permission: 'writeThread',
          policies: {
            ...basePolicies,
            enterpriseAuthMode,
          },
          user: {
            ...baseUser,
            authUserId: 'site-admin-1',
            isSiteAdmin: true,
          },
        },
      );

      expect(result.allowed).toBe(true);
      expect(result.status).toBe('satisfied');
      expect(result.supportGrant?.scope).toBe('read_write');
      expect(result.supportGrant?.ticketId).toBe('INC-99');
    },
  );

  it.each(['manageMembers', 'manageDomains', 'managePolicies', 'manageEvidence'] as const)(
    'allows site-admin org writes only with a read-write grant for %s',
    async (permission) => {
      const now = Date.now();
      const result = await resolveOrganizationEnterpriseAccess(
        createCtx({
          grants: [
            {
              _id: 'grant-1',
              organizationId: 'org-1',
              siteAdminUserId: 'site-admin-1',
              scope: 'read_write',
              ticketId: 'INC-77',
              reason: 'Escalated investigation',
              grantedByUserId: 'owner-1',
              createdAt: now,
              expiresAt: now + 60_000,
              revokedAt: null,
              revokedByUserId: null,
            },
          ],
        }),
        {
          membership: null,
          organizationId: 'org-1',
          permission,
          policies: basePolicies,
          user: {
            ...baseUser,
            authUserId: 'site-admin-1',
            isSiteAdmin: true,
          },
        },
      );

      expect(result.allowed).toBe(true);
      expect(result.status).toBe('satisfied');
      expect(result.supportGrant?.scope).toBe('read_write');
    },
  );

  it('marks expired site-admin grants distinctly', async () => {
    const now = Date.now();
    const result = await resolveOrganizationEnterpriseAccess(
      createCtx({
        grants: [
          {
            _id: 'grant-1',
            organizationId: 'org-1',
            siteAdminUserId: 'site-admin-1',
            scope: 'read_write',
            ticketId: 'INC-99',
            reason: 'Escalated investigation',
            grantedByUserId: 'owner-1',
            createdAt: now - 120_000,
            expiresAt: now - 60_000,
            revokedAt: null,
            revokedByUserId: null,
          },
        ],
      }),
      {
        membership: null,
        organizationId: 'org-1',
        permission: 'writeThread',
        policies: basePolicies,
        user: {
          ...baseUser,
          authUserId: 'site-admin-1',
          isSiteAdmin: true,
        },
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('support_grant_expired');
  });
});
