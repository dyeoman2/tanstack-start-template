import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { ServerError } from '~/lib/server/error-utils.server';

type BetterAuthActionError = {
  code: string | null;
  message: string;
  status: number;
};

type BetterAuthActionFailure = {
  error: BetterAuthActionError;
  ok: false;
};

type BetterAuthActionSuccess<TData> = {
  data: TData;
  ok: true;
};

type BetterAuthActionResult<TData> = BetterAuthActionFailure | BetterAuthActionSuccess<TData>;

type BetterAuthErrorMapper = (input: BetterAuthActionError) => string;

export type BetterAuthAdminUser = {
  banExpires: number | null;
  banReason: string | null;
  banned: boolean | null;
  createdAt: number;
  email: string;
  emailVerified: boolean;
  id: string;
  name: string | null;
  role: string | string[] | null;
  updatedAt: number;
};

export type BetterAuthAdminUserSession = {
  createdAt: number;
  expiresAt: number;
  id: string;
  impersonatedBy?: string;
  ipAddress: string | null;
  updatedAt: number;
  userAgent: string | null;
  userId: string;
};

export type BetterAuthAdminListUsersResult = {
  limit?: number;
  offset?: number;
  total: number;
  users: BetterAuthAdminUser[];
};

export type BetterAuthPasswordResetResult = {
  message: string;
  status: boolean;
};

export type BetterAuthOrganizationSummary = {
  id?: string;
  logo?: string | null;
  name?: string;
  slug?: string;
};

export type BetterAuthCreatedOrganization = {
  id: string;
  logo?: string | null;
  name: string;
  slug: string;
};

export type BetterAuthOrganizationMemberResult = {
  member: {
    id: string;
  };
};

export type BetterAuthOrganizationInvitationResult = {
  invitation: {
    id: string;
  };
};

export type BetterAuthOrganizationInviteResult = {
  id: string;
};

export type BetterAuthOrganizationSlugCheckResult = {
  status: boolean;
};

function toServerError(error: BetterAuthActionError, mapErrorMessage?: BetterAuthErrorMapper): ServerError {
  return new ServerError(mapErrorMessage?.(error) ?? error.message, error.status, error);
}

function unwrapResult<TData>(
  result: BetterAuthActionResult<TData>,
  mapErrorMessage?: BetterAuthErrorMapper,
): TData {
  if (!result.ok) {
    throw toServerError(result.error, mapErrorMessage);
  }

  return result.data;
}

export async function listBetterAuthUsers(
  query: {
    limit?: number;
    offset?: number;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthAdminListUsersResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminListUsers, query),
    mapErrorMessage,
  );
}

export async function getBetterAuthUser(
  id: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthAdminUser> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminGetUser, { id }),
    mapErrorMessage,
  );
}

export async function createBetterAuthUser(
  input: {
    email: string;
    name: string;
    password?: string;
    role?: 'admin' | 'user';
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminCreateUser, input),
    mapErrorMessage,
  );
}

export async function updateBetterAuthUser(
  input: {
    data: {
      email?: string;
      name?: string;
      phoneNumber?: string | null;
    };
    userId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthAdminUser> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminUpdateUser, input),
    mapErrorMessage,
  );
}

export async function setBetterAuthUserRole(
  input: {
    role: 'admin' | 'user';
    userId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminSetRole, input),
    mapErrorMessage,
  );
}

export async function banBetterAuthUser(
  input: {
    banExpiresIn?: number;
    banReason?: string;
    userId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminBanUser, input),
    mapErrorMessage,
  );
}

export async function unbanBetterAuthUser(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminUnbanUser, { userId }),
    mapErrorMessage,
  );
}

export async function listBetterAuthUserSessions(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ sessions: BetterAuthAdminUserSession[] }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminListUserSessions, { userId }),
    mapErrorMessage,
  );
}

export async function revokeBetterAuthUserSession(
  sessionId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminRevokeUserSession, { sessionId }),
    mapErrorMessage,
  );
}

export async function revokeBetterAuthUserSessions(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminRevokeUserSessions, { userId }),
    mapErrorMessage,
  );
}

export async function setBetterAuthUserPassword(
  input: {
    newPassword: string;
    userId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ status: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminSetUserPassword, input),
    mapErrorMessage,
  );
}

export async function removeBetterAuthUser(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.adminRemoveUser, { userId }),
    mapErrorMessage,
  );
}

export async function requestBetterAuthPasswordReset(
  input: {
    email: string;
    redirectTo?: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthPasswordResetResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.requestPasswordResetServer, input),
    mapErrorMessage,
  );
}

export async function checkBetterAuthOrganizationSlug(
  slug: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationSlugCheckResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.checkOrganizationSlugServer, { slug }),
    mapErrorMessage,
  );
}

export async function createBetterAuthOrganization(
  input: {
    keepCurrentActiveOrganization?: boolean;
    name: string;
    slug: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthCreatedOrganization> {
  const organization = unwrapResult<BetterAuthOrganizationSummary>(
    await convexAuthReactStart.fetchAuthAction(api.auth.createOrganizationServer, input),
    mapErrorMessage,
  );

  if (!organization.id || !organization.name || !organization.slug) {
    throw new ServerError('Organization create response was incomplete', 500, organization);
  }

  return {
    id: organization.id,
    ...(organization.logo !== undefined ? { logo: organization.logo } : {}),
    name: organization.name,
    slug: organization.slug,
  };
}

export async function createBetterAuthOrganizationInvitation(
  input: {
    email: string;
    organizationId: string;
    resend?: boolean;
    role: 'owner' | 'admin' | 'member';
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationInviteResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.createOrganizationInvitationServer, input),
    mapErrorMessage,
  );
}

export async function updateBetterAuthOrganizationMemberRole(
  input: {
    memberId: string;
    organizationId: string;
    role: 'owner' | 'admin' | 'member';
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationMemberResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.updateOrganizationMemberRoleServer, input),
    mapErrorMessage,
  );
}

export async function removeBetterAuthOrganizationMember(
  input: {
    memberIdOrEmail: string;
    organizationId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationMemberResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.removeOrganizationMemberServer, input),
    mapErrorMessage,
  );
}

export async function cancelBetterAuthOrganizationInvitation(
  invitationId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationInvitationResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.cancelOrganizationInvitationServer, {
      invitationId,
    }),
    mapErrorMessage,
  );
}

export async function leaveBetterAuthOrganization(
  organizationId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.leaveOrganizationServer, {
      organizationId,
    }),
    mapErrorMessage,
  );
}

export async function updateBetterAuthOrganization(
  input: {
    data: {
      logo?: string;
      name?: string;
    };
    organizationId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationSummary> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.updateOrganizationServer, input),
    mapErrorMessage,
  );
}

export async function deleteBetterAuthOrganization(
  organizationId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthOrganizationSummary> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.deleteOrganizationServer, {
      organizationId,
    }),
    mapErrorMessage,
  );
}
