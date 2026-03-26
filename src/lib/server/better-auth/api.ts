import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { ServerError } from '~/lib/server/error-utils.server';
import type { RequestAuditContext } from '~/lib/shared/request-audit-context';

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

export type BetterAuthScimTokenResult = {
  scimToken: string;
};

function toServerError(
  error: BetterAuthActionError,
  mapErrorMessage?: BetterAuthErrorMapper,
): ServerError {
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

function withRequestAuditContext<TInput extends Record<string, unknown>>(
  input: TInput,
  requestContext?: RequestAuditContext,
) {
  return requestContext ? { ...input, requestContext } : input;
}

export async function listBetterAuthUsers(
  query: {
    limit?: number;
    offset?: number;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<BetterAuthAdminListUsersResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminListUsers,
      withRequestAuditContext(query, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function getBetterAuthUser(
  id: string,
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<BetterAuthAdminUser> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminGetUser,
      withRequestAuditContext({ id }, requestContext),
    ),
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
  requestContext?: RequestAuditContext,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminCreateUser,
      withRequestAuditContext(input, requestContext),
    ),
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
  requestContext?: RequestAuditContext,
): Promise<BetterAuthAdminUser> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminUpdateUser,
      withRequestAuditContext(input, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function setBetterAuthUserRole(
  input: {
    role: 'admin' | 'user';
    userId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminSetRole,
      withRequestAuditContext(input, requestContext),
    ),
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
  requestContext?: RequestAuditContext,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminBanUser,
      withRequestAuditContext(input, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function unbanBetterAuthUser(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ user: BetterAuthAdminUser }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminUnbanUser,
      withRequestAuditContext({ userId }, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function listBetterAuthUserSessions(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ sessions: BetterAuthAdminUserSession[] }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminListUserSessions,
      withRequestAuditContext({ userId }, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function revokeBetterAuthUserSession(
  sessionId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminRevokeUserSession,
      withRequestAuditContext({ sessionId }, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function revokeBetterAuthUserSessions(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminRevokeUserSessions,
      withRequestAuditContext({ userId }, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function setBetterAuthUserPassword(
  input: {
    newPassword: string;
    userId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ status: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminSetUserPassword,
      withRequestAuditContext(input, requestContext),
    ),
    mapErrorMessage,
  );
}

export async function removeBetterAuthUser(
  userId: string,
  mapErrorMessage?: BetterAuthErrorMapper,
  requestContext?: RequestAuditContext,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.adminRemoveUser,
      withRequestAuditContext({ userId }, requestContext),
    ),
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

export async function generateBetterAuthOrganizationScimToken(
  input: {
    organizationId: string;
    providerKey: 'google-workspace' | 'entra' | 'okta';
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<BetterAuthScimTokenResult> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.generateOrganizationScimTokenServer, input),
    mapErrorMessage,
  );
}

export async function listBetterAuthOrganizationScimProviders(
  input: {
    organizationId: string;
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{
  providers: Array<{
    id: string;
    organizationId: string | null;
    providerId: string;
  }>;
}> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(api.auth.listOrganizationScimProvidersServer, input),
    mapErrorMessage,
  );
}

export async function deleteBetterAuthOrganizationScimProvider(
  input: {
    organizationId: string;
    providerKey: 'google-workspace' | 'entra' | 'okta';
  },
  mapErrorMessage?: BetterAuthErrorMapper,
): Promise<{ success: boolean }> {
  return unwrapResult(
    await convexAuthReactStart.fetchAuthAction(
      api.auth.deleteOrganizationScimProviderServer,
      input,
    ),
    mapErrorMessage,
  );
}
