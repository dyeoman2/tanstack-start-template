import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createOrganizationMock,
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock,
  getVerifiedCurrentUserFromActionOrThrowMock,
  requireStepUpFromActionOrThrowMock,
} = vi.hoisted(() => ({
  createOrganizationMock: vi.fn(),
  getVerifiedCurrentSiteAdminUserFromActionOrThrowMock: vi.fn(),
  getVerifiedCurrentUserFromActionOrThrowMock: vi.fn(),
  requireStepUpFromActionOrThrowMock: vi.fn(),
}));

vi.mock('./auth/access', () => ({
  getVerifiedCurrentSiteAdminUserFromActionOrThrow:
    getVerifiedCurrentSiteAdminUserFromActionOrThrowMock,
  getVerifiedCurrentUserFromActionOrThrow: getVerifiedCurrentUserFromActionOrThrowMock,
  requireStepUpFromActionOrThrow: requireStepUpFromActionOrThrowMock,
}));

const ORIGINAL_ENV = { ...process.env };

describe('createOrganizationServer', () => {
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
          createOrganization: createOrganizationMock,
        },
      },
      headers: new Headers(),
    } as never);

    const handler = (authModule.createOrganizationServer as any)._handler as (
      ctx: unknown,
      args: { keepCurrentActiveOrganization?: boolean; name: string; slug: string },
    ) => Promise<unknown>;

    await expect(
      handler({} as never, { keepCurrentActiveOrganization: false, name: 'Acme', slug: 'acme' }),
    ).rejects.toMatchObject({
      data: {
        code: 'MFA_REQUIRED',
        message: 'Multi-factor authentication is required for this session',
      },
    });
    expect(createOrganizationMock).not.toHaveBeenCalled();
  });

  it('calls Better Auth for app-assured sessions', async () => {
    getVerifiedCurrentUserFromActionOrThrowMock.mockResolvedValue({
      authUserId: 'auth_user_1',
    });
    createOrganizationMock.mockResolvedValue({
      id: 'org_1',
      logo: null,
      name: 'Acme',
      slug: 'acme',
    });

    const authModule = await import('./auth');
    vi.spyOn(authModule.authComponent, 'getAuth').mockResolvedValue({
      auth: {
        api: {
          createOrganization: createOrganizationMock,
        },
      },
      headers: new Headers(),
    } as never);

    const handler = (authModule.createOrganizationServer as any)._handler as (
      ctx: unknown,
      args: { keepCurrentActiveOrganization?: boolean; name: string; slug: string },
    ) => Promise<{
      data: { id?: string; logo?: string | null; name?: string; slug?: string };
      ok: boolean;
    }>;

    await expect(
      handler({} as never, { keepCurrentActiveOrganization: false, name: 'Acme', slug: 'acme' }),
    ).resolves.toEqual({
      data: {
        id: 'org_1',
        logo: null,
        name: 'Acme',
        slug: 'acme',
      },
      ok: true,
    });
    expect(createOrganizationMock).toHaveBeenCalledWith({
      body: { keepCurrentActiveOrganization: false, name: 'Acme', slug: 'acme' },
      headers: expect.any(Headers),
    });
  });
});
