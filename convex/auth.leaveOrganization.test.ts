import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock,
  getVerifiedCurrentUserFromActionOrThrowMock,
  leaveOrganizationMock,
  requireStepUpFromActionOrThrowMock,
} = vi.hoisted(() => ({
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock: vi.fn(),
  getVerifiedCurrentUserFromActionOrThrowMock: vi.fn(),
  leaveOrganizationMock: vi.fn(),
  requireStepUpFromActionOrThrowMock: vi.fn(),
}));

vi.mock('./auth/access', () => ({
  getVerifiedCurrentSiteAdminUserFromActionOrThrow:
    getVerifiedCurrentSiteAdminUserFromActionOrThrowMock,
  getVerifiedCurrentUserFromActionOrThrow: getVerifiedCurrentUserFromActionOrThrowMock,
  requireStepUpFromActionOrThrow: requireStepUpFromActionOrThrowMock,
}));

const ORIGINAL_ENV = { ...process.env };

describe('leaveOrganizationServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('rejects non-assured sessions before calling Better Auth', async () => {
    getVerifiedCurrentUserFromActionOrThrowMock.mockRejectedValue(
      new ConvexError({
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for this session',
      }),
    );

    const authModule = await import('./auth');
    vi.spyOn(authModule.authComponent, 'getAuth').mockResolvedValue({
      auth: {
        api: {
          leaveOrganization: leaveOrganizationMock,
        },
      },
      headers: new Headers(),
    } as never);

    const handler = (authModule.leaveOrganizationServer as any)._handler as (
      ctx: unknown,
      args: { organizationId: string },
    ) => Promise<unknown>;

    await expect(handler({} as never, { organizationId: 'org_1' })).rejects.toMatchObject({
      data: {
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for this session',
      },
    });
    expect(leaveOrganizationMock).not.toHaveBeenCalled();
  });

  it('calls Better Auth for app-assured sessions', async () => {
    getVerifiedCurrentUserFromActionOrThrowMock.mockResolvedValue({
      authUserId: 'auth_user_1',
    });
    leaveOrganizationMock.mockResolvedValue({ success: true });

    const authModule = await import('./auth');
    vi.spyOn(authModule.authComponent, 'getAuth').mockResolvedValue({
      auth: {
        api: {
          leaveOrganization: leaveOrganizationMock,
        },
      },
      headers: new Headers(),
    } as never);

    const handler = (authModule.leaveOrganizationServer as any)._handler as (
      ctx: unknown,
      args: { organizationId: string },
    ) => Promise<{ data: { success: boolean }; ok: boolean }>;

    await expect(handler({} as never, { organizationId: 'org_1' })).resolves.toEqual({
      data: { success: true },
      ok: true,
    });
    expect(getVerifiedCurrentUserFromActionOrThrowMock).toHaveBeenCalledTimes(1);
    expect(leaveOrganizationMock).toHaveBeenCalledWith({
      body: { organizationId: 'org_1' },
      headers: expect.any(Headers),
    });
  });
});
