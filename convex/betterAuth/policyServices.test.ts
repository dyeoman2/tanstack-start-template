import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchBetterAuthMembersByUserId = vi.hoisted(() => vi.fn());
const mockFetchBetterAuthOrganizationsByIds = vi.hoisted(() => vi.fn());
const mockFindBetterAuthAccountByUserIdAndProviderId = vi.hoisted(() => vi.fn());
const mockFindBetterAuthMember = vi.hoisted(() => vi.fn());
const mockFindBetterAuthScimProviderById = vi.hoisted(() => vi.fn());
const mockGetOrganizationMembershipStateByOrganizationUser = vi.hoisted(() => vi.fn());
const mockGetOrganizationMembershipStatuses = vi.hoisted(() => vi.fn());
const mockGetGoogleOAuthCredentials = vi.hoisted(() => vi.fn());
const mockIsGoogleWorkspaceOAuthConfigured = vi.hoisted(() => vi.fn());
const mockJwtVerify = vi.hoisted(() => vi.fn());
const mockCreateRemoteJWKSet = vi.hoisted(() => vi.fn(() => Symbol('jwks')));

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        create: 'betterAuth.adapter.create',
        findOne: 'betterAuth.adapter.findOne',
      },
    },
  },
}));

vi.mock('../lib/betterAuth', () => ({
  fetchBetterAuthMembersByUserId: mockFetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds: mockFetchBetterAuthOrganizationsByIds,
  findBetterAuthAccountByUserIdAndProviderId: mockFindBetterAuthAccountByUserIdAndProviderId,
  findBetterAuthMember: mockFindBetterAuthMember,
  findBetterAuthScimProviderById: mockFindBetterAuthScimProviderById,
}));

vi.mock('../lib/organizationMembershipState', () => ({
  getOrganizationMembershipStateByOrganizationUser:
    mockGetOrganizationMembershipStateByOrganizationUser,
  getOrganizationMembershipStatuses: mockGetOrganizationMembershipStatuses,
}));

vi.mock('../../src/lib/server/env.server', () => ({
  getGoogleOAuthCredentials: mockGetGoogleOAuthCredentials,
  isGoogleWorkspaceOAuthConfigured: mockIsGoogleWorkspaceOAuthConfigured,
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: mockCreateRemoteJWKSet,
  jwtVerify: mockJwtVerify,
}));

import {
  assertScimManagementAccess,
  canUserSelfServeCreateOrganization,
  deriveGoogleHostedDomainFromIdToken,
  getPasswordAuthBlockMessage,
  resolveEnterpriseSessionContext,
  resolveInitialActiveOrganizationId,
} from './policyServices';

function createCtx(overrides?: {
  runMutation?: (fn: unknown, args: unknown) => Promise<unknown>;
  runQuery?: (fn: unknown, args: unknown) => Promise<unknown>;
}) {
  return {
    runMutation: overrides?.runMutation,
    runQuery:
      overrides?.runQuery ??
      vi.fn(async (fn: unknown, args: unknown) => {
        if (fn === 'betterAuth.adapter.findOne') {
          return null;
        }

        void args;
        return null;
      }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGoogleOAuthCredentials.mockReturnValue({
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
  });
  mockIsGoogleWorkspaceOAuthConfigured.mockReturnValue(true);
});

describe('canUserSelfServeCreateOrganization', () => {
  it('allows site admins to bypass the self-serve org cap', async () => {
    const result = await canUserSelfServeCreateOrganization(createCtx(), {
      id: 'user_admin',
      role: 'admin',
    });

    expect(result).toBe(true);
    expect(mockFetchBetterAuthMembersByUserId).not.toHaveBeenCalled();
  });

  it('denies regular users once they already belong to two organizations', async () => {
    mockFetchBetterAuthMembersByUserId.mockResolvedValue([
      { organizationId: 'org_1' },
      { organizationId: 'org_2' },
    ]);

    const result = await canUserSelfServeCreateOrganization(createCtx(), {
      id: 'user_member',
      role: 'user',
    });

    expect(result).toBe(false);
  });
});

describe('getPasswordAuthBlockMessage', () => {
  it('blocks password auth when enterprise auth is required with no fallback', async () => {
    const ctx = createCtx({
      runQuery: vi.fn(async () => ({
        canUsePasswordFallback: false,
        enterpriseAuthMode: 'required',
        organizationName: 'Acme Health',
        providerLabel: 'Google Workspace',
        providerStatus: 'active',
      })),
    });

    await expect(getPasswordAuthBlockMessage(ctx, 'clinician@example.com')).resolves.toBe(
      'Acme Health requires Google Workspace sign-in for this email domain.',
    );
  });
});

describe('assertScimManagementAccess', () => {
  it('allows site admins to manage SCIM without membership checks', async () => {
    const ctx = createCtx({
      runQuery: vi.fn(async (fn: unknown) => {
        if (fn === 'betterAuth.adapter.findOne') {
          return { role: 'admin' };
        }

        return null;
      }),
    });

    await expect(
      assertScimManagementAccess(ctx, {
        organizationId: 'org_1',
        userId: 'user_admin',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows organization owners to manage SCIM', async () => {
    mockFindBetterAuthMember.mockResolvedValue({ role: 'owner' });

    await expect(
      assertScimManagementAccess(createCtx(), {
        organizationId: 'org_1',
        userId: 'user_owner',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects non-owners when they try to manage SCIM', async () => {
    mockFindBetterAuthMember.mockResolvedValue({ role: 'member' });

    await expect(
      assertScimManagementAccess(createCtx(), {
        organizationId: 'org_1',
        userId: 'user_member',
      }),
    ).rejects.toMatchObject({
      body: {
        message: 'Organization owner access required to manage SCIM.',
      },
    });
  });
});

describe('resolveInitialActiveOrganizationId', () => {
  it('returns the preferred organization when its membership is active', async () => {
    mockFetchBetterAuthMembersByUserId.mockResolvedValue([
      { _id: 'member_1', organizationId: 'org_1' },
      { _id: 'member_2', organizationId: 'org_2' },
    ]);
    mockGetOrganizationMembershipStatuses.mockResolvedValue(
      new Map([
        ['member_1', 'active'],
        ['member_2', 'suspended'],
      ]),
    );
    mockFetchBetterAuthOrganizationsByIds.mockResolvedValue([{ _id: 'org_1' }, { _id: 'org_2' }]);

    await expect(resolveInitialActiveOrganizationId(createCtx(), 'user_1', 'org_1')).resolves.toBe(
      'org_1',
    );
  });

  it('skips suspended memberships and falls back to another active organization', async () => {
    mockFetchBetterAuthMembersByUserId.mockResolvedValue([
      { _id: 'member_1', organizationId: 'org_1' },
      { _id: 'member_2', organizationId: 'org_2' },
    ]);
    mockGetOrganizationMembershipStatuses.mockResolvedValue(
      new Map([
        ['member_1', 'suspended'],
        ['member_2', 'active'],
      ]),
    );
    mockFetchBetterAuthOrganizationsByIds.mockResolvedValue([{ _id: 'org_1' }, { _id: 'org_2' }]);

    await expect(resolveInitialActiveOrganizationId(createCtx(), 'user_1', 'org_1')).resolves.toBe(
      'org_2',
    );
  });
});

describe('resolveEnterpriseSessionContext', () => {
  it('returns an enterprise session for a valid Google Workspace hosted-domain match', async () => {
    mockFindBetterAuthAccountByUserIdAndProviderId.mockResolvedValue({
      googleHostedDomain: 'acmehealth.org',
    });
    mockFindBetterAuthMember.mockResolvedValue({
      organizationId: 'org_1',
      role: 'member',
      userId: 'user_1',
    });

    const ctx = createCtx({
      runQuery: vi.fn(async () => ({
        managedDomain: 'acmehealth.org',
        organizationId: 'org_1',
        providerKey: 'google-workspace',
        providerStatus: 'active',
        verifiedDomains: ['acmehealth.org'],
      })),
    });

    await expect(
      resolveEnterpriseSessionContext(ctx, {
        providerId: 'google',
        userEmail: 'clinician@acmehealth.org',
        userId: 'user_1',
      }),
    ).resolves.toEqual({
      organizationId: 'org_1',
      protocol: 'oidc',
      providerKey: 'google-workspace',
    });
  });

  it('returns null when the enterprise provider is inactive', async () => {
    mockFindBetterAuthAccountByUserIdAndProviderId.mockResolvedValue({
      googleHostedDomain: 'acmehealth.org',
    });

    const ctx = createCtx({
      runQuery: vi.fn(async () => ({
        managedDomain: 'acmehealth.org',
        organizationId: 'org_1',
        providerKey: 'google-workspace',
        providerStatus: 'inactive',
        verifiedDomains: ['acmehealth.org'],
      })),
    });

    await expect(
      resolveEnterpriseSessionContext(ctx, {
        providerId: 'google',
        userEmail: 'clinician@acmehealth.org',
        userId: 'user_1',
      }),
    ).resolves.toBeNull();
  });

  it('returns null when the hosted domain does not match the managed domain', async () => {
    mockFindBetterAuthAccountByUserIdAndProviderId.mockResolvedValue({
      googleHostedDomain: 'example.org',
    });

    const ctx = createCtx({
      runQuery: vi.fn(async () => ({
        managedDomain: 'acmehealth.org',
        organizationId: 'org_1',
        providerKey: 'google-workspace',
        providerStatus: 'active',
        verifiedDomains: ['acmehealth.org'],
      })),
    });

    await expect(
      resolveEnterpriseSessionContext(ctx, {
        providerId: 'google',
        userEmail: 'clinician@acmehealth.org',
        userId: 'user_1',
      }),
    ).resolves.toBeNull();
  });

  it('returns null when JIT membership creation cannot complete', async () => {
    mockFindBetterAuthAccountByUserIdAndProviderId.mockResolvedValue({
      googleHostedDomain: 'acmehealth.org',
    });
    mockFindBetterAuthMember.mockResolvedValue(null);
    mockGetOrganizationMembershipStateByOrganizationUser.mockResolvedValue(null);

    const ctx = createCtx({
      runQuery: vi.fn(async () => ({
        managedDomain: 'acmehealth.org',
        organizationId: 'org_1',
        providerKey: 'google-workspace',
        providerStatus: 'active',
        verifiedDomains: ['acmehealth.org'],
      })),
    });

    await expect(
      resolveEnterpriseSessionContext(ctx, {
        providerId: 'google',
        userEmail: 'clinician@acmehealth.org',
        userId: 'user_1',
      }),
    ).resolves.toBeNull();
  });

  it('derives a hosted domain only from verified Google id tokens', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        email_verified: true,
        hd: 'acmehealth.org',
      },
    });

    await expect(deriveGoogleHostedDomainFromIdToken('google-id-token')).resolves.toBe(
      'acmehealth.org',
    );
  });
});
