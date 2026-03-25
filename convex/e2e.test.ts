import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assertUserIdMock, findBetterAuthUserByEmailMock, updateBetterAuthUserRecordMock } =
  vi.hoisted(() => ({
    assertUserIdMock: vi.fn(),
    findBetterAuthUserByEmailMock: vi.fn(),
    updateBetterAuthUserRecordMock: vi.fn(),
  }));

vi.mock('./_generated/server', () => ({
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
}));

vi.mock('./_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        deleteMany: 'deleteMany',
      },
    },
  },
  internal: {
    dashboardStats: {
      recomputeUserCounts: 'recomputeUserCounts',
    },
    users: {
      bootstrapUserContext: 'bootstrapUserContext',
    },
  },
}));

vi.mock('./lib/betterAuth', () => ({
  findBetterAuthUserByEmail: findBetterAuthUserByEmailMock,
  updateBetterAuthUserRecord: updateBetterAuthUserRecordMock,
}));

vi.mock('../src/lib/shared/user-id', () => ({
  assertUserId: assertUserIdMock,
}));

import { ensurePrincipalRole } from './e2e';

const ensurePrincipalRoleHandler = (
  ensurePrincipalRole as unknown as {
    handler: (ctx: unknown, args: { email: string; role: 'user' | 'admin' }) => Promise<unknown>;
  }
).handler;

describe('ensurePrincipalRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_DEPLOYMENT_ENV = 'development';
    process.env.ENABLE_E2E_TEST_AUTH = 'true';
  });

  it('bootstraps user context through the shared bootstrap action', async () => {
    findBetterAuthUserByEmailMock.mockResolvedValue({ email: 'e2e-user@local.test', id: 'user_1' });
    assertUserIdMock.mockReturnValue('user_1');

    const runAction = vi.fn().mockResolvedValue({
      found: true,
      organizationId: 'org_1',
      userId: 'user_ctx_1',
    });

    const result = await ensurePrincipalRoleHandler({ runAction } as never, {
      email: 'e2e-user@local.test',
      role: 'user',
    });

    expect(updateBetterAuthUserRecordMock).toHaveBeenCalledWith(
      expect.any(Object),
      'user_1',
      expect.objectContaining({ role: 'user' }),
    );
    expect(runAction).toHaveBeenCalledWith('bootstrapUserContext', {
      authUserId: 'user_1',
      email: 'e2e-user@local.test',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(result).toEqual({
      found: true,
      role: 'user',
      userId: 'user_1',
    });
  });

  it('fails clearly when bootstrap cannot initialize context', async () => {
    findBetterAuthUserByEmailMock.mockResolvedValue({ email: 'e2e-user@local.test', id: 'user_1' });
    assertUserIdMock.mockReturnValue('user_1');

    await expect(
      ensurePrincipalRoleHandler(
        {
          runAction: vi.fn().mockResolvedValue({ found: false }),
        } as never,
        { email: 'e2e-user@local.test', role: 'admin' },
      ),
    ).rejects.toThrow('Failed to bootstrap E2E principal context for e2e-user@local.test');
  });

  it('returns found false when the auth user does not exist', async () => {
    findBetterAuthUserByEmailMock.mockResolvedValue(null);

    const result = await ensurePrincipalRoleHandler({ runAction: vi.fn() } as never, {
      email: 'missing@local.test',
      role: 'user',
    });

    expect(result).toEqual({ found: false });
  });

  it('rejects e2e helpers outside explicit development or test deployments', async () => {
    process.env.APP_DEPLOYMENT_ENV = 'preview';

    await expect(
      ensurePrincipalRoleHandler({ runAction: vi.fn() } as never, {
        email: 'e2e-user@local.test',
        role: 'user',
      }),
    ).rejects.toThrow('E2E test auth is not available in this deployment');
  });
});
