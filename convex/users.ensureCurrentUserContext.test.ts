import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createBetterAuthMemberMock,
  createBetterAuthOrganizationMock,
  fetchBetterAuthMembersByUserIdMock,
  getCurrentAuthUserOrNullMock,
  getCurrentAuthUserOrThrowMock,
  getCurrentSetupAuthUserFromActionOrThrowMock,
  getCurrentUserOrNullMock,
  getVerifiedCurrentUserFromActionOrThrowMock,
} = vi.hoisted(() => ({
  createBetterAuthMemberMock: vi.fn(),
  createBetterAuthOrganizationMock: vi.fn(),
  fetchBetterAuthMembersByUserIdMock: vi.fn(),
  getCurrentAuthUserOrNullMock: vi.fn(),
  getCurrentAuthUserOrThrowMock: vi.fn(),
  getCurrentSetupAuthUserFromActionOrThrowMock: vi.fn(),
  getCurrentUserOrNullMock: vi.fn(),
  getVerifiedCurrentUserFromActionOrThrowMock: vi.fn(),
}));

vi.mock('./auth', () => ({
  authComponent: {
    getAuthUser: vi.fn(),
  },
  getCurrentSetupAuthUserFromActionOrThrow: getCurrentSetupAuthUserFromActionOrThrowMock,
}));

vi.mock('./auth/access', () => ({
  buildCurrentUserProfile: vi.fn(),
  getCurrentAuthUserOrNull: getCurrentAuthUserOrNullMock,
  getCurrentAuthUserOrThrow: getCurrentAuthUserOrThrowMock,
  getCurrentUserOrNull: getCurrentUserOrNullMock,
  getVerifiedCurrentUserFromActionOrThrow: getVerifiedCurrentUserFromActionOrThrowMock,
}));

vi.mock('./_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {},
    },
  },
  internal: {
    users: {
      ensureUserContextForAuthUser: 'internal.users.ensureUserContextForAuthUser',
    },
  },
}));

vi.mock('./lib/betterAuth', () => ({
  createBetterAuthMember: createBetterAuthMemberMock,
  createBetterAuthOrganization: createBetterAuthOrganizationMock,
  fetchBetterAuthMembersByUserId: fetchBetterAuthMembersByUserIdMock,
  fetchBetterAuthOrganizationsByIds: vi.fn(),
  fetchBetterAuthSessionsByUserId: vi.fn(),
  findBetterAuthUserByEmail: vi.fn(),
  normalizeBetterAuthUserProfile: vi.fn(),
  updateBetterAuthSessionRecord: vi.fn(),
}));

describe('ensureCurrentUserContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-assured sessions before mutating tenant state', async () => {
    getVerifiedCurrentUserFromActionOrThrowMock.mockRejectedValue(
      new ConvexError({
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for this session',
      }),
    );

    const usersModule = await import('./users');
    const handler = (usersModule.ensureCurrentUserContext as any)._handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<unknown>;

    const runMutation = vi.fn();

    await expect(handler({ runMutation } as never, {})).rejects.toMatchObject({
      data: {
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for this session',
      },
    });
    expect(fetchBetterAuthMembersByUserIdMock).not.toHaveBeenCalled();
    expect(createBetterAuthOrganizationMock).not.toHaveBeenCalled();
    expect(createBetterAuthMemberMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('persists context without default-org creation when memberships exist', async () => {
    getVerifiedCurrentUserFromActionOrThrowMock.mockResolvedValue({
      authUserId: 'auth_user_1',
    });
    fetchBetterAuthMembersByUserIdMock.mockResolvedValue([{ organizationId: 'org_1' }]);

    const usersModule = await import('./users');
    const handler = (usersModule.ensureCurrentUserContext as any)._handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<{ organizationId: string; userId: string }>;

    const runMutation = vi.fn(async (_ref: string, args: Record<string, unknown>) => ({
      organizationId: 'org_1',
      userId: args.authUserId,
    }));

    await expect(handler({ runMutation } as never, {})).resolves.toEqual({
      organizationId: 'org_1',
      userId: 'auth_user_1',
    });
    expect(createBetterAuthOrganizationMock).not.toHaveBeenCalled();
    expect(createBetterAuthMemberMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith('internal.users.ensureUserContextForAuthUser', {
      authUserId: 'auth_user_1',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it('creates a default organization before persisting context when memberships are absent', async () => {
    getVerifiedCurrentUserFromActionOrThrowMock.mockResolvedValue({
      authUserId: 'auth_user_1',
    });
    fetchBetterAuthMembersByUserIdMock.mockResolvedValue([]);
    createBetterAuthOrganizationMock.mockResolvedValue({
      _id: 'org_new',
      id: 'org_new',
      name: 'New Organization',
      slug: 'org-auth-use-abc123',
    });
    createBetterAuthMemberMock.mockResolvedValue({ id: 'member_1' });

    const usersModule = await import('./users');
    const handler = (usersModule.ensureCurrentUserContext as any)._handler as (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<{ organizationId: string; userId: string }>;

    const runMutation = vi.fn(async (_ref: string, args: Record<string, unknown>) => ({
      organizationId: 'org_new',
      userId: args.authUserId,
    }));

    await expect(handler({ runMutation } as never, {})).resolves.toEqual({
      organizationId: 'org_new',
      userId: 'auth_user_1',
    });
    expect(createBetterAuthOrganizationMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        createdAt: expect.any(Number),
        name: 'New Organization',
      }),
    );
    expect(createBetterAuthMemberMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: 'org_new',
        role: 'owner',
        userId: 'auth_user_1',
      }),
    );
    expect(runMutation).toHaveBeenCalledWith('internal.users.ensureUserContextForAuthUser', {
      authUserId: 'auth_user_1',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });
});
