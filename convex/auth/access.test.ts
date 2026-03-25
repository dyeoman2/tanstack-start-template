import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';

const { getAuthUserMock, safeGetAuthUserMock, getCompatibilityStepUpClaimMock } = vi.hoisted(
  () => ({
    getAuthUserMock: vi.fn(),
    safeGetAuthUserMock: vi.fn(),
    getCompatibilityStepUpClaimMock: vi.fn(),
  }),
);

vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => getAuthUserMock(...args),
    safeGetAuthUser: (...args: unknown[]) => safeGetAuthUserMock(...args),
  },
}));

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth.findMany',
        findOne: 'betterAuth.findOne',
      },
    },
  },
  internal: {
    users: {
      getCurrentAppUserInternal: 'internal.users.getCurrentAppUserInternal',
    },
  },
}));

vi.mock('../stepUp', () => ({
  getActiveStepUpClaim: vi.fn(),
  getCompatibilityStepUpClaim: (...args: unknown[]) => getCompatibilityStepUpClaimMock(...args),
}));

function createUsersQueryResult(user: Record<string, unknown> | null) {
  return {
    withIndex: (
      _indexName: string,
      buildRange: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      const q = {
        eq: (_field: string, _value: unknown) => q,
      };
      buildRange(q);
      return {
        first: vi.fn(async () => user),
      };
    },
  };
}

function createQueryCtx(input: {
  appUser?: Record<string, unknown>;
  authSession?: Record<string, unknown> | null;
  authUser?: Record<string, unknown>;
  passkeys?: unknown[];
}) {
  return {
    auth: {
      getUserIdentity: vi.fn(async () => ({
        sessionId: input.authSession ? 'session_1' : null,
      })),
    },
    db: {
      query: vi.fn((table: string) => {
        if (table === 'users') {
          return createUsersQueryResult(input.appUser ?? null);
        }

        throw new Error(`Unexpected table query: ${table}`);
      }),
    },
    runQuery: vi.fn(async (ref: string) => {
      if (ref === 'betterAuth.findOne') {
        return input.authSession ?? null;
      }

      if (ref === 'betterAuth.findMany') {
        return {
          page: input.passkeys ?? [],
        };
      }

      throw new Error(`Unexpected query ref: ${ref}`);
    }),
  };
}

function createActionCtx(user: Record<string, unknown> | null) {
  return {
    runQuery: vi.fn(async (ref: string) => {
      if (ref === 'internal.users.getCurrentAppUserInternal') {
        return user;
      }

      if (ref === 'betterAuth.findMany') {
        return {
          page: [],
        };
      }

      throw new Error(`Unexpected query ref: ${ref}`);
    }),
  };
}

describe('normalizeUserRole', () => {
  it('normalizes scalar and array Better Auth role payloads', () => {
    expect(normalizeUserRole('admin')).toBe('admin');
    expect(normalizeUserRole('user')).toBe('user');
    expect(normalizeUserRole(['user', 'admin'])).toBe('admin');
    expect(normalizeUserRole(['user'])).toBe('user');
  });
});

describe('deriveIsSiteAdmin', () => {
  it('derives site admin from normalized role', () => {
    expect(deriveIsSiteAdmin('admin')).toBe(true);
    expect(deriveIsSiteAdmin('user')).toBe(false);
  });
});

describe('access constants', () => {
  it('preserves the expected permission lattice', async () => {
    process.env.BETTER_AUTH_SECRET = 'test-secret-abcdefghijklmnopqrstuvwxyz';
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';

    const { ADMIN_ACCESS, EDIT_ACCESS, NO_ACCESS, SITE_ADMIN_ACCESS, VIEW_ACCESS } =
      await import('./access');

    expect(SITE_ADMIN_ACCESS.delete).toBe(true);
    expect(ADMIN_ACCESS.edit).toBe(true);
    expect(ADMIN_ACCESS.delete).toBe(false);
    expect(EDIT_ACCESS.view).toBe(true);
    expect(EDIT_ACCESS.delete).toBe(false);
    expect(VIEW_ACCESS.edit).toBe(false);
    expect(NO_ACCESS.view).toBe(false);
  });

  it('treats every org-scoped permission as enterprise-protected by default', async () => {
    const { requiresEnterpriseSatisfied } = await import('../lib/enterpriseAccess');
    const { ORGANIZATION_PERMISSION_VALUES } = await import('../lib/organizationPermissions');

    expect(
      ORGANIZATION_PERMISSION_VALUES.every((permission) => requiresEnterpriseSatisfied(permission)),
    ).toBe(true);
  });
});

describe('verified current user helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompatibilityStepUpClaimMock.mockResolvedValue(null);
  });

  it('denies query access when MFA enrollment is missing', async () => {
    getAuthUserMock.mockResolvedValue({
      createdAt: Date.now(),
      email: 'user@example.com',
      emailVerified: true,
      id: 'auth_user_1',
      role: 'user',
      twoFactorEnabled: false,
    });

    const ctx = createQueryCtx({
      appUser: {
        _id: 'user_1',
        authUserId: 'auth_user_1',
        createdAt: 1,
        lastActiveOrganizationId: 'org_1',
        updatedAt: 1,
      },
      authSession: {
        _id: 'session_1',
        activeOrganizationId: null,
        authMethod: 'password',
        createdAt: Date.now(),
        id: 'session_1',
        mfaVerified: false,
        updatedAt: Date.now(),
      },
      passkeys: [],
    });

    const { getVerifiedCurrentUserOrThrow } = await import('./access');

    await expect(getVerifiedCurrentUserOrThrow(ctx as never)).rejects.toMatchObject({
      data: {
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication setup is required',
      },
    });
  });

  it('denies query access when the session is not MFA-assured', async () => {
    getAuthUserMock.mockResolvedValue({
      createdAt: Date.now(),
      email: 'user@example.com',
      emailVerified: true,
      id: 'auth_user_1',
      role: 'user',
      twoFactorEnabled: true,
    });

    const ctx = createQueryCtx({
      appUser: {
        _id: 'user_1',
        authUserId: 'auth_user_1',
        createdAt: 1,
        lastActiveOrganizationId: 'org_1',
        updatedAt: 1,
      },
      authSession: {
        _id: 'session_1',
        activeOrganizationId: null,
        authMethod: 'password',
        createdAt: Date.now(),
        id: 'session_1',
        mfaVerified: false,
        updatedAt: Date.now(),
      },
      passkeys: [],
    });

    const { getVerifiedCurrentUserOrThrow } = await import('./access');

    await expect(getVerifiedCurrentUserOrThrow(ctx as never)).rejects.toMatchObject({
      data: {
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for this session',
      },
    });
  });

  it('allows passkey-authenticated query sessions', async () => {
    getAuthUserMock.mockResolvedValue({
      createdAt: Date.now(),
      email: 'user@example.com',
      emailVerified: true,
      id: 'auth_user_1',
      role: 'user',
      twoFactorEnabled: false,
    });

    const ctx = createQueryCtx({
      appUser: {
        _id: 'user_1',
        authUserId: 'auth_user_1',
        createdAt: 1,
        lastActiveOrganizationId: 'org_1',
        updatedAt: 1,
      },
      authSession: {
        _id: 'session_1',
        activeOrganizationId: null,
        authMethod: 'passkey',
        createdAt: Date.now(),
        id: 'session_1',
        mfaVerified: false,
        updatedAt: Date.now(),
      },
      passkeys: [{ _id: 'passkey_1' }],
    });

    const { getVerifiedCurrentUserOrThrow } = await import('./access');

    await expect(getVerifiedCurrentUserOrThrow(ctx as never)).resolves.toMatchObject({
      authUserId: 'auth_user_1',
    });
  });

  it('allows action sessions after TOTP verification', async () => {
    const { getVerifiedCurrentUserFromActionOrThrow } = await import('./access');

    await expect(
      getVerifiedCurrentUserFromActionOrThrow(
        createActionCtx({
          _id: 'user_1',
          activeOrganizationId: 'org_1',
          authSession: {
            authMethod: 'password',
            id: 'session_1',
            mfaVerified: true,
          },
          authUser: {
            createdAt: Date.now(),
            email: 'user@example.com',
            emailVerified: true,
            id: 'auth_user_1',
            role: 'user',
            twoFactorEnabled: true,
          },
          authUserId: 'auth_user_1',
          createdAt: 1,
          isSiteAdmin: false,
          lastActiveOrganizationId: 'org_1',
          updatedAt: 1,
        }) as never,
      ),
    ).resolves.toMatchObject({
      authUserId: 'auth_user_1',
    });
  });
});
