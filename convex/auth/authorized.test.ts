import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  accessConstants,
  checkOrganizationAccessMock,
  getCurrentSiteAdminAuthUserOrThrowMock,
  getVerifiedCurrentSiteAdminUserOrThrowMock,
  getVerifiedCurrentUserOrThrowMock,
} = vi.hoisted(() => ({
  accessConstants: {
    ADMIN_ACCESS: {
      admin: true,
      delete: true,
      edit: true,
      view: true,
      siteAdmin: false,
    },
    EDIT_ACCESS: {
      admin: false,
      delete: false,
      edit: true,
      view: true,
      siteAdmin: false,
    },
    NO_ACCESS: {
      admin: false,
      delete: false,
      edit: false,
      view: false,
      siteAdmin: false,
    },
    VIEW_ACCESS: {
      admin: false,
      delete: false,
      edit: false,
      view: true,
      siteAdmin: false,
    },
  },
  checkOrganizationAccessMock: vi.fn(),
  getCurrentSiteAdminAuthUserOrThrowMock: vi.fn(),
  getVerifiedCurrentSiteAdminUserOrThrowMock: vi.fn(),
  getVerifiedCurrentUserOrThrowMock: vi.fn(),
}));

vi.mock('./access', async () => {
  return {
    ADMIN_ACCESS: accessConstants.ADMIN_ACCESS,
    checkOrganizationAccess: checkOrganizationAccessMock,
    getCurrentSiteAdminAuthUserOrThrow: getCurrentSiteAdminAuthUserOrThrowMock,
    getVerifiedCurrentSiteAdminUserOrThrow: getVerifiedCurrentSiteAdminUserOrThrowMock,
    getVerifiedCurrentUserOrThrow: getVerifiedCurrentUserOrThrowMock,
  };
});

import {
  authorizeOptionalOrganizationView,
  authorizeOrganizationAdmin,
  authorizeOrganizationEdit,
  authorizeOrganizationView,
  authorizeSiteAdminActionContext,
  authorizeSiteAdminQueryContext,
} from './authorized';

const baseUser = {
  _id: 'user_1',
  authUserId: 'auth_user_1',
  activeOrganizationId: 'org_1',
  authUser: {
    id: 'auth_user_1',
    role: 'user',
  },
  createdAt: 1,
  lastActiveOrganizationId: 'org_1',
  updatedAt: 1,
  isSiteAdmin: false,
};

describe('authorized helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('injects organization view context for authorized members', async () => {
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue(baseUser);
    checkOrganizationAccessMock.mockResolvedValue(accessConstants.VIEW_ACCESS);

    const ctx = await authorizeOrganizationView({} as never, 'org_1');

    expect(checkOrganizationAccessMock).toHaveBeenCalledWith(expect.any(Object), 'org_1', {
      user: baseUser,
    });
    expect(ctx.user).toEqual(baseUser);
    expect(ctx.access).toEqual(accessConstants.VIEW_ACCESS);
    expect(ctx.organizationId).toBe('org_1');
  });

  it('blocks organization edits before the handler runs', async () => {
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue(baseUser);
    checkOrganizationAccessMock.mockResolvedValue(accessConstants.NO_ACCESS);

    await expect(authorizeOrganizationEdit({} as never, 'org_1')).rejects.toMatchObject({
      data: {
        code: 'FORBIDDEN',
      },
    });
  });

  it('allows site admins through org admin authorization without membership', async () => {
    const siteAdmin = {
      ...baseUser,
      authUser: {
        ...baseUser.authUser,
        role: 'admin',
      },
      isSiteAdmin: true,
    };
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue(siteAdmin);

    const ctx = await authorizeOrganizationAdmin({} as never, 'org_1');

    expect(checkOrganizationAccessMock).not.toHaveBeenCalled();
    expect(ctx.access).toEqual(accessConstants.ADMIN_ACCESS);
    expect(ctx.user).toEqual(siteAdmin);
  });

  it('keeps optional organization queries authenticated but unscopeable', async () => {
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue(baseUser);

    const ctx = await authorizeOptionalOrganizationView({} as never, null);

    expect(checkOrganizationAccessMock).not.toHaveBeenCalled();
    expect(ctx.organizationId).toBeNull();
    expect(ctx.access).toBeNull();
    expect(ctx.user).toEqual(baseUser);
  });

  it('rejects site-admin query access for non-admins', async () => {
    getVerifiedCurrentSiteAdminUserOrThrowMock.mockRejectedValue(
      new ConvexError({ code: 'ADMIN_REQUIRED', message: 'Site admin access required' }),
    );

    await expect(authorizeSiteAdminQueryContext({} as never)).rejects.toMatchObject({
      data: {
        code: 'ADMIN_REQUIRED',
      },
    });
  });

  it('injects verified site-admin users for site-admin queries', async () => {
    const siteAdmin = {
      ...baseUser,
      authUser: {
        ...baseUser.authUser,
        role: 'admin',
      },
      isSiteAdmin: true,
    };
    getVerifiedCurrentSiteAdminUserOrThrowMock.mockResolvedValue(siteAdmin);

    const ctx = await authorizeSiteAdminQueryContext({} as never);

    expect(ctx.user).toEqual(siteAdmin);
  });

  it('injects site-admin auth users for privileged actions', async () => {
    const authUser = {
      id: 'auth_user_1',
      role: 'admin',
    };
    getCurrentSiteAdminAuthUserOrThrowMock.mockResolvedValue(authUser);

    const ctx = await authorizeSiteAdminActionContext({} as never);

    expect(ctx.authUser).toEqual(authUser);
  });

  it('uses edit-level access when a member is authorized', async () => {
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue(baseUser);
    checkOrganizationAccessMock.mockResolvedValue(accessConstants.EDIT_ACCESS);

    const ctx = await authorizeOrganizationEdit({} as never, 'org_1');

    expect(ctx.access).toEqual(accessConstants.EDIT_ACCESS);
  });
});
