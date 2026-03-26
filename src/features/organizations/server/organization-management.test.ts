import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZATION_AUDIT_EVENT_TYPES } from '~/features/organizations/lib/organization-management';
import { ServerError } from '~/lib/server/error-utils.server';

const {
  cancelBetterAuthOrganizationInvitationMock,
  checkBetterAuthOrganizationSlugMock,
  createBetterAuthOrganizationInvitationMock,
  createBetterAuthOrganizationMock,
  deleteBetterAuthOrganizationScimProviderMock,
  deleteBetterAuthOrganizationMock,
  generateBetterAuthOrganizationScimTokenMock,
  getBetterAuthRequestMock,
  runConvexAdminMutationMock,
  removeBetterAuthOrganizationMemberMock,
  requireAuthMock,
  resolveRequestAuditContextMock,
  fetchAuthActionMock,
  fetchAuthMutationMock,
  fetchAuthQueryMock,
  handleServerErrorMock,
  updateBetterAuthOrganizationMemberRoleMock,
  updateBetterAuthOrganizationMock,
} = vi.hoisted(() => ({
  cancelBetterAuthOrganizationInvitationMock: vi.fn(),
  checkBetterAuthOrganizationSlugMock: vi.fn(),
  createBetterAuthOrganizationInvitationMock: vi.fn(),
  createBetterAuthOrganizationMock: vi.fn(),
  deleteBetterAuthOrganizationScimProviderMock: vi.fn(),
  deleteBetterAuthOrganizationMock: vi.fn(),
  generateBetterAuthOrganizationScimTokenMock: vi.fn(),
  getBetterAuthRequestMock: vi.fn(),
  runConvexAdminMutationMock: vi.fn(),
  removeBetterAuthOrganizationMemberMock: vi.fn(),
  requireAuthMock: vi.fn(),
  resolveRequestAuditContextMock: vi.fn(),
  fetchAuthActionMock: vi.fn(),
  fetchAuthMutationMock: vi.fn(),
  fetchAuthQueryMock: vi.fn(),
  handleServerErrorMock: vi.fn((error: unknown) => error),
  updateBetterAuthOrganizationMemberRoleMock: vi.fn(),
  updateBetterAuthOrganizationMock: vi.fn(),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator() {
      return this;
    },
    handler: (handler: (...args: unknown[]) => unknown) => handler,
  }),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    users: {
      ensureCurrentUserContext: 'ensureCurrentUserContext',
    },
    organizationManagement: {
      applyOrganizationLegalHold: 'applyOrganizationLegalHold',
      createOrganizationSupportAccessGrant: 'createOrganizationSupportAccessGrant',
      deactivateOrganizationMember: 'deactivateOrganizationMember',
      executePreparedOrganizationCleanup: 'executePreparedOrganizationCleanup',
      exportOrganizationAuditCsv: 'exportOrganizationAuditCsv',
      exportOrganizationDirectoryCsv: 'exportOrganizationDirectoryCsv',
      getOrganizationCreationEligibility: 'getOrganizationCreationEligibility',
      getOrganizationWriteAccess: 'getOrganizationWriteAccess',
      prepareOrganizationCleanup: 'prepareOrganizationCleanup',
      releaseOrganizationLegalHold: 'releaseOrganizationLegalHold',
      reactivateOrganizationMember: 'reactivateOrganizationMember',
      revokeOrganizationSupportAccessGrant: 'revokeOrganizationSupportAccessGrant',
      suspendOrganizationMember: 'suspendOrganizationMember',
      updateOrganizationSupportAccessPolicy: 'updateOrganizationSupportAccessPolicy',
      updateOrganizationPolicies: 'updateOrganizationPolicies',
    },
  },
  internal: {
    organizationManagement: {
      cleanupOrganizationDataInternal: 'cleanupOrganizationDataInternal',
      recordOrganizationBulkAuditEventsInternal: 'recordOrganizationBulkAuditEventsInternal',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
    fetchAuthMutation: fetchAuthMutationMock,
    fetchAuthQuery: fetchAuthQueryMock,
  },
}));

vi.mock('~/lib/server/convex-admin.server', () => ({
  runConvexAdminMutation: runConvexAdminMutationMock,
}));

vi.mock('~/lib/server/better-auth/http', () => ({
  getBetterAuthRequest: getBetterAuthRequestMock,
}));

vi.mock('~/lib/server/request-audit-context', () => ({
  resolveRequestAuditContext: resolveRequestAuditContextMock,
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  ServerError: class ServerError extends Error {
    statusCode: number;
    payload: unknown;

    constructor(message: string, statusCode: number, payload?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.payload = payload;
    }
  },
  handleServerError: handleServerErrorMock,
}));

vi.mock('~/lib/server/better-auth/api', () => ({
  cancelBetterAuthOrganizationInvitation: cancelBetterAuthOrganizationInvitationMock,
  checkBetterAuthOrganizationSlug: checkBetterAuthOrganizationSlugMock,
  createBetterAuthOrganization: createBetterAuthOrganizationMock,
  createBetterAuthOrganizationInvitation: createBetterAuthOrganizationInvitationMock,
  deleteBetterAuthOrganizationScimProvider: deleteBetterAuthOrganizationScimProviderMock,
  deleteBetterAuthOrganization: deleteBetterAuthOrganizationMock,
  generateBetterAuthOrganizationScimToken: generateBetterAuthOrganizationScimTokenMock,
  removeBetterAuthOrganizationMember: removeBetterAuthOrganizationMemberMock,
  updateBetterAuthOrganization: updateBetterAuthOrganizationMock,
  updateBetterAuthOrganizationMemberRole: updateBetterAuthOrganizationMemberRoleMock,
}));

import {
  applyOrganizationLegalHoldServerFn,
  bulkOrganizationDirectoryActionServerFn,
  cancelOrganizationInvitationServerFn,
  createOrganizationSupportAccessGrantServerFn,
  checkOrganizationSlugServerFn,
  createOrganizationInvitationServerFn,
  createOrganizationServerFn,
  deactivateOrganizationMemberServerFn,
  deleteOrganizationServerFn,
  deleteOrganizationScimProviderServerFn,
  exportOrganizationAuditCsvServerFn,
  exportOrganizationDirectoryCsvServerFn,
  generateOrganizationScimTokenServerFn,
  reactivateOrganizationMemberServerFn,
  releaseOrganizationLegalHoldServerFn,
  removeOrganizationMemberServerFn,
  revokeOrganizationSupportAccessGrantServerFn,
  suspendOrganizationMemberServerFn,
  updateOrganizationMemberRoleServerFn,
  updateOrganizationPoliciesServerFn,
  updateOrganizationSupportAccessPolicyServerFn,
  updateOrganizationSettingsServerFn,
} from './organization-management';

describe('organization management server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      user: {
        id: 'user_1',
        email: 'admin@example.com',
        role: 'admin',
        isSiteAdmin: true,
        emailVerified: true,
        requiresEmailVerification: false,
        mfaEnabled: true,
        mfaRequired: true,
        requiresMfaSetup: false,
        recentStepUpAt: null,
        recentStepUpValidUntil: null,
      },
    });
    fetchAuthQueryMock.mockResolvedValue({ allowed: true });
    fetchAuthMutationMock.mockResolvedValue({ success: true });
    fetchAuthActionMock.mockResolvedValue({ filename: 'report.csv', csv: 'csv-data' });
    checkBetterAuthOrganizationSlugMock.mockResolvedValue({ status: true });
    createBetterAuthOrganizationInvitationMock.mockResolvedValue({ id: 'invite-1' });
    updateBetterAuthOrganizationMemberRoleMock.mockResolvedValue({
      member: { id: 'member_1' },
    });
    updateBetterAuthOrganizationMock.mockResolvedValue({ id: 'org_1', name: 'Acme' });
    createBetterAuthOrganizationMock.mockResolvedValue({
      id: 'org_1',
      name: 'Acme',
      slug: 'acme',
    });
    generateBetterAuthOrganizationScimTokenMock.mockResolvedValue({
      scimToken: 'scim-secret-token',
    });
    deleteBetterAuthOrganizationScimProviderMock.mockResolvedValue({ success: true });
    removeBetterAuthOrganizationMemberMock.mockResolvedValue({ member: { id: 'member_1' } });
    deleteBetterAuthOrganizationMock.mockResolvedValue({ id: 'org_1' });
    cancelBetterAuthOrganizationInvitationMock.mockResolvedValue({
      invitation: { id: 'invite_1' },
    });
    runConvexAdminMutationMock.mockResolvedValue({ success: true });
    getBetterAuthRequestMock.mockReturnValue(new Request('https://app.example.com/app'));
    resolveRequestAuditContextMock.mockReturnValue({
      requestId: 'req-123',
      ipAddress: '203.0.113.9',
      userAgent: 'Vitest',
    });
  });

  it('routes managed organization writes through Better Auth actions', async () => {
    await createOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        email: ' Person@Example.com ',
        role: 'owner',
        resend: true,
      },
    });

    await updateOrganizationMemberRoleServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
        role: 'member',
      },
    });

    await updateOrganizationSettingsServerFn({
      data: {
        organizationId: 'org_1',
        name: '  Acme  ',
        logo: ' https://example.com/logo.png ',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'invite',
      organizationId: 'org_1',
      email: 'person@example.com',
      nextRole: 'owner',
      resend: true,
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'update-member-role',
      organizationId: 'org_1',
      membershipId: 'member_1',
      nextRole: 'member',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(3, 'getOrganizationWriteAccess', {
      action: 'update-settings',
      organizationId: 'org_1',
    });
    expect(createBetterAuthOrganizationInvitationMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        email: 'person@example.com',
        role: 'owner',
        resend: true,
      },
      expect.any(Function),
    );
    expect(updateBetterAuthOrganizationMemberRoleMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        memberId: 'member_1',
        role: 'member',
      },
      expect.any(Function),
    );
    expect(updateBetterAuthOrganizationMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        data: {
          name: 'Acme',
          logo: 'https://example.com/logo.png',
        },
      },
      expect.any(Function),
    );
  });

  it('fails when organization write access is denied for invitations', async () => {
    const failure = new Error('not allowed');
    handleServerErrorMock.mockReturnValue(failure);
    fetchAuthQueryMock.mockResolvedValueOnce({ allowed: false, reason: 'tenant mismatch' });

    await expect(
      createOrganizationInvitationServerFn({
        data: {
          organizationId: 'org_1',
          email: 'other@org.com',
          role: 'member',
          resend: false,
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      'Create organization invitation',
    );
  });

  it('fails when updating a member role without tenant access', async () => {
    const failure = new Error('forbidden');
    handleServerErrorMock.mockReturnValue(failure);
    fetchAuthQueryMock.mockResolvedValueOnce({ allowed: false, reason: 'not your org' });

    await expect(
      updateOrganizationMemberRoleServerFn({
        data: {
          organizationId: 'org_1',
          membershipId: 'member_1',
          role: 'member',
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      'Update organization member role',
    );
    expect(updateBetterAuthOrganizationMemberRoleMock).not.toHaveBeenCalled();
  });

  it('updates organization policies through Convex auth mutations', async () => {
    await updateOrganizationPoliciesServerFn({
      data: {
        organizationId: 'org_1',
        invitePolicy: 'owners_only',
        verifiedDomainsOnly: true,
        memberCap: 25,
        mfaRequired: true,
        enterpriseAuthMode: 'off',
        enterpriseProviderKey: null,
        enterpriseProtocol: null,
        allowBreakGlassPasswordLogin: true,
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('updateOrganizationPolicies', {
      organizationId: 'org_1',
      invitePolicy: 'owners_only',
      verifiedDomainsOnly: true,
      memberCap: 25,
      mfaRequired: true,
      enterpriseAuthMode: 'off',
      enterpriseProviderKey: null,
      enterpriseProtocol: null,
      allowBreakGlassPasswordLogin: true,
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('routes SCIM management through the dedicated manage-scim permission path', async () => {
    await generateOrganizationScimTokenServerFn({
      data: {
        organizationId: 'org_1',
        providerKey: 'google-workspace',
      },
    });

    await deleteOrganizationScimProviderServerFn({
      data: {
        organizationId: 'org_1',
        providerKey: 'google-workspace',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'manage-scim',
      organizationId: 'org_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'manage-scim',
      organizationId: 'org_1',
    });
    expect(generateBetterAuthOrganizationScimTokenMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        providerKey: 'google-workspace',
      },
      expect.any(Function),
    );
    expect(deleteBetterAuthOrganizationScimProviderMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        providerKey: 'google-workspace',
      },
      expect.any(Function),
    );
  });

  it('creates support access grants through Convex auth mutations', async () => {
    await createOrganizationSupportAccessGrantServerFn({
      data: {
        organizationId: 'org_1',
        siteAdminUserId: 'admin_1',
        scope: 'read_only',
        reasonCategory: 'incident_response',
        ticketId: 'INC-42',
        reasonDetails: 'Investigate ticket INC-42',
        expiresAt: 1_710_000_000_000,
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('createOrganizationSupportAccessGrant', {
      organizationId: 'org_1',
      siteAdminUserId: 'admin_1',
      scope: 'read_only',
      reasonCategory: 'incident_response',
      ticketId: 'INC-42',
      reasonDetails: 'Investigate ticket INC-42',
      expiresAt: 1_710_000_000_000,
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('updates support access policy through Convex auth mutations', async () => {
    await updateOrganizationSupportAccessPolicyServerFn({
      data: {
        organizationId: 'org_1',
        supportAccessEnabled: false,
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('updateOrganizationSupportAccessPolicy', {
      organizationId: 'org_1',
      supportAccessEnabled: false,
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('revokes support access grants through Convex auth mutations', async () => {
    await revokeOrganizationSupportAccessGrantServerFn({
      data: {
        organizationId: 'org_1',
        grantId: 'grant_1',
        reason: 'Issue resolved',
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('revokeOrganizationSupportAccessGrant', {
      organizationId: 'org_1',
      grantId: 'grant_1',
      reason: 'Issue resolved',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('applies legal holds through Convex auth mutations with request context', async () => {
    await applyOrganizationLegalHoldServerFn({
      data: {
        organizationId: 'org_1',
        reason: 'Preserve records for pending litigation',
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('applyOrganizationLegalHold', {
      organizationId: 'org_1',
      reason: 'Preserve records for pending litigation',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('releases legal holds through Convex auth mutations with request context', async () => {
    await releaseOrganizationLegalHoldServerFn({
      data: {
        organizationId: 'org_1',
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('releaseOrganizationLegalHold', {
      organizationId: 'org_1',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('exports audit logs through a server wrapper with request context', async () => {
    await exportOrganizationAuditCsvServerFn({
      data: {
        slug: 'acme',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        preset: 'all',
        eventType: 'all',
        search: '',
        startDate: '',
        endDate: '',
        failuresOnly: false,
      },
    });

    expect(fetchAuthActionMock).toHaveBeenCalledWith('exportOrganizationAuditCsv', {
      slug: 'acme',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      preset: 'all',
      eventType: 'all',
      search: '',
      startDate: '',
      endDate: '',
      failuresOnly: false,
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('accepts every shared organization audit event type in the export wrapper', async () => {
    const lastEventType =
      ORGANIZATION_AUDIT_EVENT_TYPES[ORGANIZATION_AUDIT_EVENT_TYPES.length - 1] ?? 'all';

    for (const eventType of ORGANIZATION_AUDIT_EVENT_TYPES) {
      await exportOrganizationAuditCsvServerFn({
        data: {
          slug: 'acme',
          sortBy: 'createdAt',
          sortOrder: 'desc',
          preset: 'all',
          eventType,
          search: '',
          startDate: '',
          endDate: '',
          failuresOnly: false,
        },
      });
    }

    expect(fetchAuthActionMock).toHaveBeenCalledTimes(ORGANIZATION_AUDIT_EVENT_TYPES.length);
    expect(fetchAuthActionMock).toHaveBeenLastCalledWith('exportOrganizationAuditCsv', {
      slug: 'acme',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      preset: 'all',
      eventType: lastEventType,
      search: '',
      startDate: '',
      endDate: '',
      failuresOnly: false,
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('exports directories through a server wrapper with request context', async () => {
    await exportOrganizationDirectoryCsvServerFn({
      data: {
        slug: 'acme',
        asOf: 1_710_000_000_000,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        secondarySortBy: 'email',
        secondarySortOrder: 'asc',
        search: '',
        kind: 'all',
      },
    });

    expect(fetchAuthActionMock).toHaveBeenCalledWith('exportOrganizationDirectoryCsv', {
      slug: 'acme',
      asOf: 1_710_000_000_000,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      secondarySortBy: 'email',
      secondarySortOrder: 'asc',
      search: '',
      kind: 'all',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('routes membership state changes through Convex mutations with preflight access', async () => {
    await suspendOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    await deactivateOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    await reactivateOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'suspend-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'deactivate-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(3, 'getOrganizationWriteAccess', {
      action: 'reactivate-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(1, 'suspendOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(2, 'deactivateOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(3, 'reactivateOrganizationMember', {
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(1, 'ensureCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(2, 'ensureCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(3, 'ensureCurrentUserContext', {});
  });

  it('creates organizations through the server flow when the viewer is eligible', async () => {
    fetchAuthQueryMock.mockResolvedValueOnce({
      count: 1,
      limit: 2,
      canCreate: true,
      reason: null,
      isUnlimited: false,
    });

    const result = await createOrganizationServerFn({
      data: {
        name: '  Acme  ',
        slug: 'acme',
      },
    });

    expect(result).toEqual({ id: 'org_1', name: 'Acme', slug: 'acme' });
    expect(fetchAuthQueryMock).toHaveBeenCalledWith('getOrganizationCreationEligibility', {});
    expect(checkBetterAuthOrganizationSlugMock).toHaveBeenCalledWith('acme', expect.any(Function));
    expect(createBetterAuthOrganizationMock).toHaveBeenCalledWith(
      {
        keepCurrentActiveOrganization: false,
        name: 'Acme',
        slug: 'acme',
      },
      expect.any(Function),
    );
    expect(fetchAuthActionMock).toHaveBeenCalledWith('ensureCurrentUserContext', {});
  });

  it('does not refresh user context when organization creation is blocked by MFA enforcement', async () => {
    const failure = new ServerError(
      'Multi-factor authentication is required for this session',
      403,
      {
        code: 'MFA_REQUIRED',
      },
    );
    fetchAuthQueryMock.mockResolvedValueOnce({
      count: 1,
      limit: 2,
      canCreate: true,
      reason: null,
      isUnlimited: false,
    });
    createBetterAuthOrganizationMock.mockRejectedValue(failure);
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationServerFn({
        data: {
          name: 'Acme',
          slug: 'acme',
        },
      }),
    ).rejects.toBe(failure);

    expect(fetchAuthActionMock).not.toHaveBeenCalled();
  });

  it('checks slug availability through Better Auth before creation', async () => {
    const result = await checkOrganizationSlugServerFn({
      data: {
        slug: '  Acme Health  ',
      },
    });

    expect(result).toEqual({
      available: true,
      slug: 'acme-health',
    });
    expect(checkBetterAuthOrganizationSlugMock).toHaveBeenCalledWith(
      'acme-health',
      expect.any(Function),
    );
  });

  it('refreshes user context after member removal and organization deletion', async () => {
    fetchAuthMutationMock.mockResolvedValueOnce({ cleanupRequestId: 'cleanup_1' });
    fetchAuthActionMock.mockResolvedValue({ organizationId: 'org_next' });

    await removeOrganizationMemberServerFn({
      data: {
        organizationId: 'org_1',
        membershipId: 'member_1',
      },
    });

    await deleteOrganizationServerFn({
      data: {
        organizationId: 'org_1',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(1, 'getOrganizationWriteAccess', {
      action: 'remove-member',
      organizationId: 'org_1',
      membershipId: 'member_1',
    });
    expect(fetchAuthQueryMock).toHaveBeenNthCalledWith(2, 'getOrganizationWriteAccess', {
      action: 'delete-organization',
      organizationId: 'org_1',
    });
    expect(removeBetterAuthOrganizationMemberMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        memberIdOrEmail: 'member_1',
      },
      expect.any(Function),
    );
    expect(deleteBetterAuthOrganizationMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(fetchAuthMutationMock).toHaveBeenNthCalledWith(1, 'prepareOrganizationCleanup', {
      organizationId: 'org_1',
    });
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(1, 'ensureCurrentUserContext', {});
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(2, 'executePreparedOrganizationCleanup', {
      cleanupRequestId: 'cleanup_1',
    });
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(3, 'ensureCurrentUserContext', {});
  });

  it('calls the Better Auth invitation cancel endpoint', async () => {
    await cancelOrganizationInvitationServerFn({
      data: {
        organizationId: 'org_1',
        invitationId: 'invite_1',
      },
    });

    expect(fetchAuthQueryMock).toHaveBeenCalledWith('getOrganizationWriteAccess', {
      action: 'cancel-invitation',
      organizationId: 'org_1',
    });
    expect(cancelBetterAuthOrganizationInvitationMock).toHaveBeenCalledWith(
      'invite_1',
      expect.any(Function),
    );
  });

  it('runs bulk invitation revocation and records internal bulk audit events', async () => {
    await bulkOrganizationDirectoryActionServerFn({
      data: {
        organizationId: 'org_1',
        action: 'revoke-invites',
        invitations: [
          {
            invitationId: 'invite_1',
            email: 'invitee@example.com',
            role: 'member',
          },
        ],
        members: [],
      },
    });

    expect(cancelBetterAuthOrganizationInvitationMock).toHaveBeenCalledWith(
      'invite_1',
      expect.any(Function),
    );
    expect(runConvexAdminMutationMock).toHaveBeenCalledWith(
      'organizationManagement:recordOrganizationBulkAuditEventsInternal',
      {
        organizationId: 'org_1',
        eventType: 'bulk_invite_revoked',
        entries: [
          {
            targetEmail: 'invitee@example.com',
            targetId: 'invite_1',
            targetRole: 'member',
          },
        ],
      },
    );
    expect(fetchAuthMutationMock).not.toHaveBeenCalledWith('recordOrganizationBulkAuditEvents', {
      organizationId: 'org_1',
      eventType: 'bulk_invite_revoked',
      entries: [
        {
          targetEmail: 'invitee@example.com',
          targetId: 'invite_1',
          targetRole: 'member',
        },
      ],
    });
  });

  it('records only the successful subset for bulk invitation revocation', async () => {
    cancelBetterAuthOrganizationInvitationMock
      .mockResolvedValueOnce({ invitation: { id: 'invite_1' } })
      .mockRejectedValueOnce(new Error('Invitation not found'));

    const result = await bulkOrganizationDirectoryActionServerFn({
      data: {
        organizationId: 'org_1',
        action: 'revoke-invites',
        invitations: [
          {
            invitationId: 'invite_1',
            email: 'invitee@example.com',
            role: 'member',
          },
          {
            invitationId: 'invite_2',
            email: 'second@example.com',
            role: 'admin',
          },
        ],
        members: [],
      },
    });

    expect(result).toEqual({
      results: [
        { key: 'invite_1', success: true },
        { key: 'invite_2', success: false, message: 'Invitation not found' },
      ],
      successCount: 1,
      failureCount: 1,
    });
    expect(runConvexAdminMutationMock).toHaveBeenCalledWith(
      'organizationManagement:recordOrganizationBulkAuditEventsInternal',
      {
        organizationId: 'org_1',
        eventType: 'bulk_invite_revoked',
        entries: [
          {
            targetEmail: 'invitee@example.com',
            targetId: 'invite_1',
            targetRole: 'member',
          },
        ],
      },
    );
  });

  it('records internal audit events for successful bulk member removals and refreshes context', async () => {
    await bulkOrganizationDirectoryActionServerFn({
      data: {
        organizationId: 'org_1',
        action: 'remove-members',
        invitations: [],
        members: [
          {
            membershipId: 'member_1',
            email: 'member@example.com',
            role: 'admin',
          },
        ],
      },
    });

    expect(removeBetterAuthOrganizationMemberMock).toHaveBeenCalledWith(
      {
        organizationId: 'org_1',
        memberIdOrEmail: 'member_1',
      },
      expect.any(Function),
    );
    expect(runConvexAdminMutationMock).toHaveBeenCalledWith(
      'organizationManagement:recordOrganizationBulkAuditEventsInternal',
      {
        organizationId: 'org_1',
        eventType: 'bulk_member_removed',
        entries: [
          {
            targetEmail: 'member@example.com',
            targetId: 'member_1',
            targetRole: 'admin',
          },
        ],
      },
    );
    expect(fetchAuthActionMock).toHaveBeenCalledWith('ensureCurrentUserContext', {});
  });

  it('wraps Better Auth action failures with mapped org messages', async () => {
    const failure = new Error('wrapped org failure');
    createBetterAuthOrganizationInvitationMock.mockRejectedValue(
      new Error('That user already has a pending invitation'),
    );
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationInvitationServerFn({
        data: {
          organizationId: 'org_1',
          email: 'person@example.com',
          role: 'member',
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'That user already has a pending invitation',
      }),
      'Create organization invitation',
    );
  });

  it('surfaces preflight invite role failures before calling Better Auth', async () => {
    const failure = new Error('wrapped invite failure');
    fetchAuthQueryMock.mockResolvedValueOnce({
      allowed: false,
      reason: 'You cannot assign that organization role',
    });
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationInvitationServerFn({
        data: {
          organizationId: 'org_1',
          email: 'person@example.com',
          role: 'owner',
        },
      }),
    ).rejects.toBe(failure);

    expect(createBetterAuthOrganizationInvitationMock).not.toHaveBeenCalled();
    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'You cannot assign that organization role',
      }),
      'Create organization invitation',
    );
  });

  it('blocks organization creation when the viewer is at the membership limit', async () => {
    const failure = new Error('wrapped create failure');
    fetchAuthQueryMock.mockResolvedValueOnce({
      count: 2,
      limit: 2,
      canCreate: false,
      reason: 'You can belong to up to 2 organizations.',
      isUnlimited: false,
    });
    handleServerErrorMock.mockReturnValue(failure);

    await expect(
      createOrganizationServerFn({
        data: {
          name: 'Acme',
          slug: 'acme',
        },
      }),
    ).rejects.toBe(failure);

    expect(handleServerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'You can belong to up to 2 organizations.',
      }),
      'Create organization',
    );
  });
});
