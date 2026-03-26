import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireOrganizationPermissionMock,
  checkOrganizationAccessMock,
  getVerifiedCurrentUserOrThrowMock,
  findBetterAuthMemberMock,
  findBetterAuthOrganizationByIdMock,
  canManageOrganizationPoliciesMock,
  recordUserAuditEventMock,
} = vi.hoisted(() => ({
  requireOrganizationPermissionMock: vi.fn(),
  checkOrganizationAccessMock: vi.fn(),
  getVerifiedCurrentUserOrThrowMock: vi.fn(),
  findBetterAuthMemberMock: vi.fn(),
  findBetterAuthOrganizationByIdMock: vi.fn(),
  canManageOrganizationPoliciesMock: vi.fn(),
  recordUserAuditEventMock: vi.fn(),
}));

vi.mock('./_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));

vi.mock('./auth/access', () => ({
  checkOrganizationAccess: checkOrganizationAccessMock,
  getCurrentUserOrNull: vi.fn(),
  getVerifiedCurrentUserFromActionOrThrow: vi.fn(),
  getVerifiedCurrentUserOrThrow: getVerifiedCurrentUserOrThrowMock,
  listOrganizationMembers: vi.fn(),
  requireOrganizationPermission: requireOrganizationPermissionMock,
  requireOrganizationPermissionFromActionOrThrow: vi.fn(),
}));

vi.mock('./stepUp', () => ({
  getActiveStepUpClaim: vi.fn(),
}));

vi.mock('../src/features/organizations/lib/organization-permissions', () => ({
  ORGANIZATION_AUDIT_EVENT_TYPES: ['retention_hold_applied', 'retention_hold_released'],
  canChangeMemberRole: vi.fn(() => false),
  canDeleteOrganization: vi.fn(() => false),
  canManageDomains: vi.fn(() => false),
  canManageMemberState: vi.fn(() => false),
  canManageOrganization: vi.fn(() => false),
  canManageOrganizationPolicies: canManageOrganizationPoliciesMock,
  canRemoveMember: vi.fn(() => false),
  canViewOrganizationAudit: vi.fn(() => false),
  deriveViewerRole: vi.fn((input: { isSiteAdmin: boolean; membershipRole: string | null }) =>
    input.isSiteAdmin ? 'site-admin' : (input.membershipRole ?? 'none'),
  ),
  getAssignableRoles: vi.fn(() => []),
  normalizeOrganizationRole: vi.fn((role: string) => role),
}));

vi.mock('./lib/betterAuth', () => ({
  fetchAllBetterAuthOrganizations: vi.fn(),
  fetchBetterAuthInvitationsByOrganizationId: vi.fn(),
  fetchBetterAuthMembersByUserId: vi.fn(),
  fetchBetterAuthOrganizationsByIds: vi.fn(),
  fetchBetterAuthUsersByIds: vi.fn(),
  findBetterAuthMember: findBetterAuthMemberMock,
  findBetterAuthOrganizationById: findBetterAuthOrganizationByIdMock,
  findBetterAuthOrganizationBySlug: vi.fn(),
  findBetterAuthScimProviderByOrganizationId: vi.fn(),
}));

vi.mock('./lib/auditEmitters', () => ({
  recordUserAuditEvent: recordUserAuditEventMock,
}));

import {
  applyOrganizationLegalHoldHandler,
  releaseOrganizationLegalHoldHandler,
} from './organizationManagement';

function createMutationCtx() {
  const legalHolds = new Map<string, Record<string, unknown>>();
  let insertCounter = 0;

  return {
    ctx: {
      db: {
        async get(id: string) {
          return legalHolds.get(id) ?? null;
        },
        async insert(table: string, value: Record<string, unknown>) {
          if (table !== 'organizationLegalHolds') {
            throw new Error(`Unexpected insert table: ${table}`);
          }

          insertCounter += 1;
          const id = `hold-${insertCounter}`;
          legalHolds.set(id, {
            _id: id,
            _creationTime: 1_710_000_000_000 + insertCounter,
            ...value,
          });
          return id;
        },
        async patch(id: string, value: Record<string, unknown>) {
          const existing = legalHolds.get(id);
          if (!existing) {
            throw new Error(`Missing legal hold ${id}`);
          }

          legalHolds.set(id, {
            ...existing,
            ...value,
          });
        },
        query(table: string) {
          if (table !== 'organizationLegalHolds') {
            throw new Error(`Unexpected query table: ${table}`);
          }

          return {
            withIndex(
              indexName: string,
              buildRange?: (query: {
                eq: (
                  field: string,
                  value: unknown,
                ) => { eq: (field: string, value: unknown) => unknown };
              }) => unknown,
            ) {
              if (indexName !== 'by_organization_id_and_status') {
                throw new Error(`Unexpected legal-hold index: ${indexName}`);
              }

              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return queryBuilder;
                },
              };
              buildRange?.(queryBuilder);

              const matches = [...legalHolds.values()].filter((hold) =>
                filters.every(([field, expected]) => hold[field] === expected),
              );

              return {
                async unique() {
                  return matches[0] ?? null;
                },
              };
            },
          };
        },
      },
    },
    seedActiveHold() {
      legalHolds.set('hold-existing', {
        _id: 'hold-existing',
        _creationTime: 1_710_000_000_000,
        organizationId: 'org_1',
        status: 'active',
        reason: 'Preserve evidence',
        openedAt: 1_710_000_000_000,
        openedByUserId: 'user_1',
        releasedAt: undefined,
        releasedByUserId: undefined,
        createdAt: 1_710_000_000_000,
        updatedAt: 1_710_000_000_000,
      });
    },
  };
}

describe('organization legal hold audit context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOrganizationPermissionMock.mockResolvedValue(undefined);
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue({
      authSession: {
        id: 'session_1',
        ipAddress: '198.51.100.5',
        userAgent: 'Session Agent',
      },
      authUser: {
        email: 'owner@example.com',
      },
      authUserId: 'user_1',
      isSiteAdmin: false,
    });
    findBetterAuthOrganizationByIdMock.mockResolvedValue({
      id: 'org_1',
      slug: 'acme',
    });
    checkOrganizationAccessMock.mockResolvedValue({
      view: true,
    });
    findBetterAuthMemberMock.mockResolvedValue({
      role: 'owner',
    });
    canManageOrganizationPoliciesMock.mockImplementation((role: string) => role === 'owner');
    recordUserAuditEventMock.mockResolvedValue(undefined);
  });

  it('records explicit request audit fields when applying a legal hold', async () => {
    const { ctx } = createMutationCtx();

    await applyOrganizationLegalHoldHandler(ctx as never, {
      organizationId: 'org_1',
      reason: ' Preserve records for litigation ',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Forwarded Agent',
      },
    });

    expect(recordUserAuditEventMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: 'retention_hold_applied',
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Forwarded Agent',
      }),
    );
  });

  it('creates an active legal hold for owner callers', async () => {
    const { ctx } = createMutationCtx();

    const result = await applyOrganizationLegalHoldHandler(ctx as never, {
      organizationId: 'org_1',
      reason: 'Preserve records for litigation',
      requestContext: undefined,
    });

    expect(result).toMatchObject({
      success: true,
      hold: expect.objectContaining({
        organizationId: 'org_1',
        reason: 'Preserve records for litigation',
        status: 'active',
        openedByUserId: 'user_1',
      }),
    });
    expect(requireOrganizationPermissionMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        organizationId: 'org_1',
        permission: 'managePolicies',
      }),
    );
    expect(recordUserAuditEventMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: 'retention_hold_applied',
      }),
    );
  });

  it('rejects non-owner callers from applying a legal hold', async () => {
    const { ctx } = createMutationCtx();
    findBetterAuthMemberMock.mockResolvedValueOnce({
      role: 'admin',
    });
    canManageOrganizationPoliciesMock.mockReturnValueOnce(false);

    await expect(
      applyOrganizationLegalHoldHandler(ctx as never, {
        organizationId: 'org_1',
        reason: 'Preserve records for litigation',
        requestContext: undefined,
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        code: 'FORBIDDEN',
      }),
    });

    expect(recordUserAuditEventMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate active holds', async () => {
    const { ctx, seedActiveHold } = createMutationCtx();
    seedActiveHold();

    await expect(
      applyOrganizationLegalHoldHandler(ctx as never, {
        organizationId: 'org_1',
        reason: 'Preserve records for litigation',
        requestContext: undefined,
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        code: 'VALIDATION',
      }),
    });

    expect(recordUserAuditEventMock).not.toHaveBeenCalled();
  });

  it('falls back to session audit fields when releasing a legal hold', async () => {
    const { ctx, seedActiveHold } = createMutationCtx();
    seedActiveHold();

    await releaseOrganizationLegalHoldHandler(ctx as never, {
      organizationId: 'org_1',
      requestContext: {
        requestId: 'req-456',
        ipAddress: ' ',
        userAgent: null,
      },
    });

    expect(recordUserAuditEventMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: 'retention_hold_released',
        requestId: 'req-456',
        ipAddress: '198.51.100.5',
        userAgent: 'Session Agent',
      }),
    );
  });

  it('releases the active legal hold and records audit evidence', async () => {
    const { ctx, seedActiveHold } = createMutationCtx();
    seedActiveHold();

    const result = await releaseOrganizationLegalHoldHandler(ctx as never, {
      organizationId: 'org_1',
      requestContext: undefined,
    });

    expect(result).toMatchObject({
      success: true,
      hold: expect.objectContaining({
        organizationId: 'org_1',
        status: 'released',
        releasedByUserId: 'user_1',
      }),
    });
    expect(recordUserAuditEventMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: 'retention_hold_released',
      }),
    );
  });

  it('rejects release when no active hold exists', async () => {
    const { ctx } = createMutationCtx();

    await expect(
      releaseOrganizationLegalHoldHandler(ctx as never, {
        organizationId: 'org_1',
        requestContext: undefined,
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        code: 'VALIDATION',
      }),
    });

    expect(recordUserAuditEventMock).not.toHaveBeenCalled();
  });
});
