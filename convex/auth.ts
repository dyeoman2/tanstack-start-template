'use node';

import {
  type CreateAuth as ConvexBetterAuthCreateAuth,
  createClient,
  type GenericCtx,
} from '@convex-dev/better-auth';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { anyApi } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { normalizeOrganizationRole } from '../src/features/organizations/lib/organization-permissions';
import {
  getBetterAuthSecret,
  isGoogleWorkspaceOAuthConfigured,
} from '../src/lib/server/env.server';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { action, internalAction } from './_generated/server';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentUserFromActionOrThrow,
} from './auth/access';
import {
  assertScimManagementAccess,
  canUserSelfServeCreateOrganization,
  getPasswordAuthBlockMessage,
  resolveEnterpriseSessionContext,
  resolveInitialActiveOrganizationId,
} from './betterAuth/policyServices';
import {
  createSendChangeEmailConfirmationHandler,
  createSendInvitationEmailHandler,
  createSendResetPasswordHandler,
  createSendVerificationEmailHandler,
} from './lib/betterAuthEmailServices';
import betterAuthSchema from './betterAuth/schema';
import {
  createSharedBetterAuthOptions,
  ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS,
  type OrganizationPluginOptions,
} from './betterAuth/sharedOptions';
import { createAuthAuditPlugin } from './lib/authAudit';
import {
  createActorScopedRateLimitKey,
  createEmailScopedRateLimitKey,
  enforceServerAuthRateLimit,
} from './lib/authRateLimits';
import {
  createBetterAuthMember,
  deleteBetterAuthMemberRecord,
  fetchBetterAuthInvitationsByOrganizationAndEmail,
  fetchBetterAuthMembersByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  fetchBetterAuthSessionsByUserId,
  fetchBetterAuthUsersByIds,
  findBetterAuthAccountByAccountIdAndProviderId,
  findBetterAuthAccountByUserIdAndProviderId,
  findBetterAuthInvitationById,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
  findBetterAuthScimProviderById,
  findBetterAuthScimProviderByOrganizationId,
  findBetterAuthUserByEmail,
  updateBetterAuthAccountRecord,
  updateBetterAuthSessionRecord,
  updateBetterAuthUserRecord,
} from './lib/betterAuth';
import {
  getOrganizationMembershipStateByOrganizationUser,
  getOrganizationMembershipStatuses,
} from './lib/organizationMembershipState';
import {
  currentUserSessionsValidator,
  organizationRoleValidator,
  rateLimitResultValidator,
} from './lib/returnValidators';

const secret = getBetterAuthSecret();

export const authComponent = createClient<DataModel, typeof betterAuthSchema>(
  components.betterAuth,
  {
    local: {
      schema: betterAuthSchema,
    },
  },
);

const betterAuthActionErrorValidator = v.object({
  code: v.union(v.string(), v.null()),
  message: v.string(),
  status: v.number(),
});

const adminUserRoleValidator = v.union(v.string(), v.array(v.string()), v.null());
const betterAuthActionSuccessValidator = <
  TValidator extends
    | ReturnType<typeof v.object>
    | ReturnType<typeof v.union>
    | ReturnType<typeof v.array>
    | ReturnType<typeof v.literal>
    | ReturnType<typeof v.string>
    | ReturnType<typeof v.boolean>
    | ReturnType<typeof v.number>,
>(
  dataValidator: TValidator,
) =>
  v.object({
    data: dataValidator,
    ok: v.literal(true),
  });

const betterAuthActionFailureValidator = v.object({
  error: betterAuthActionErrorValidator,
  ok: v.literal(false),
});

const betterAuthAdminUserValidator = v.object({
  banExpires: v.union(v.number(), v.null()),
  banReason: v.union(v.string(), v.null()),
  banned: v.union(v.boolean(), v.null()),
  createdAt: v.number(),
  email: v.string(),
  emailVerified: v.boolean(),
  id: v.string(),
  name: v.union(v.string(), v.null()),
  role: adminUserRoleValidator,
  updatedAt: v.number(),
});

const betterAuthAdminSessionValidator = v.object({
  createdAt: v.number(),
  expiresAt: v.number(),
  id: v.string(),
  impersonatedBy: v.optional(v.string()),
  ipAddress: v.union(v.string(), v.null()),
  updatedAt: v.number(),
  userAgent: v.union(v.string(), v.null()),
  userId: v.string(),
});

const betterAuthOrganizationSummaryValidator = v.object({
  id: v.optional(v.string()),
  logo: v.optional(v.union(v.string(), v.null())),
  name: v.optional(v.string()),
  slug: v.optional(v.string()),
});

const betterAuthOrganizationMemberResultValidator = v.object({
  member: v.object({
    id: v.string(),
  }),
});

const betterAuthOrganizationInvitationResultValidator = v.object({
  invitation: v.object({
    id: v.string(),
  }),
});

const enterpriseProviderKeyValidator = v.union(
  v.literal('google-workspace'),
  v.literal('entra'),
  v.literal('okta'),
);

const betterAuthScimProviderValidator = v.object({
  id: v.string(),
  providerId: v.string(),
  organizationId: v.union(v.string(), v.null()),
});

const betterAuthScimProviderListValidator = v.object({
  providers: v.array(betterAuthScimProviderValidator),
});

const betterAuthScimTokenResultValidator = v.object({
  scimToken: v.string(),
});

const betterAuthCurrentSessionTimestampsValidator = v.union(
  v.object({
    createdAt: v.number(),
    updatedAt: v.union(v.number(), v.null()),
  }),
  v.null(),
);

const betterAuthCurrentSessionValidator = v.union(
  v.object({
    session: betterAuthCurrentSessionTimestampsValidator,
  }),
  v.null(),
);

const scimLifecycleOperationValidator = v.union(
  v.literal('delete'),
  v.literal('patch'),
  v.literal('post'),
  v.literal('put'),
);

const scimLifecycleResponseValidator = v.object({
  body: v.union(v.string(), v.null()),
  handled: v.boolean(),
  location: v.union(v.string(), v.null()),
  status: v.number(),
});

const betterAuthActionResultValidator = <
  TValidator extends
    | ReturnType<typeof v.object>
    | ReturnType<typeof v.union>
    | ReturnType<typeof v.array>
    | ReturnType<typeof v.literal>
    | ReturnType<typeof v.string>
    | ReturnType<typeof v.boolean>
    | ReturnType<typeof v.number>,
>(
  dataValidator: TValidator,
) => v.union(betterAuthActionSuccessValidator(dataValidator), betterAuthActionFailureValidator);

type BetterAuthActionError = {
  code: string | null;
  message: string;
  status: number;
};

type BetterAuthActionResult<TData> =
  | {
      data: TData;
      ok: true;
    }
  | {
      error: BetterAuthActionError;
      ok: false;
    };

type BetterAuthAdminUser = {
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

type BetterAuthAdminSession = {
  createdAt: number;
  expiresAt: number;
  id: string;
  impersonatedBy?: string;
  ipAddress: string | null;
  updatedAt: number;
  userAgent: string | null;
  userId: string;
};

type BetterAuthCurrentUserSession = {
  createdAt: number;
  expiresAt: number;
  id: string;
  ipAddress: string | null;
  isCurrent: boolean;
  updatedAt: number;
  userAgent: string | null;
};

type BetterAuthOrganizationSummary = {
  id?: string;
  logo?: string | null;
  name?: string;
  slug?: string;
};

type BetterAuthCoreApiSurface = {
  getSession(input: {
    headers: Headers;
    query?: {
      disableCookieCache?: boolean;
    };
  }): Promise<{
    session: {
      id: string;
      createdAt: Date | number | string;
      updatedAt?: Date | number | string | null;
    } | null;
  } | null>;
  listSessions(input: { headers: Headers }): Promise<
    Array<{
      createdAt: Date | number | string;
      expiresAt: Date | number | string;
      id: string;
      ipAddress?: string | null;
      token: string;
      updatedAt: Date | number | string;
      userAgent?: string | null;
      userId: string;
    }>
  >;
  listUsers(input: { headers: Headers; query?: { limit?: number; offset?: number } }): Promise<{
    limit?: number;
    offset?: number;
    total: number;
    users: Array<Parameters<typeof normalizeAdminUserRecord>[0]>;
  }>;
  getUser(input: {
    headers: Headers;
    query: { id: string };
  }): Promise<Parameters<typeof normalizeAdminUserRecord>[0]>;
  createUser(input: {
    body: {
      email: string;
      name: string;
      password?: string;
      role?: 'admin' | 'user';
    };
    headers: Headers;
  }): Promise<{ user: Parameters<typeof normalizeAdminUserRecord>[0] }>;
  adminUpdateUser(input: {
    body: {
      data: {
        email?: string;
        name?: string;
        phoneNumber?: string | null;
      };
      userId: string;
    };
    headers: Headers;
  }): Promise<Parameters<typeof normalizeAdminUserRecord>[0]>;
  setRole(input: {
    body: { role: 'admin' | 'user'; userId: string };
    headers: Headers;
  }): Promise<{ user: Parameters<typeof normalizeAdminUserRecord>[0] }>;
  banUser(input: {
    body: { banExpiresIn?: number; banReason?: string; userId: string };
    headers: Headers;
  }): Promise<{ user: Parameters<typeof normalizeAdminUserRecord>[0] }>;
  unbanUser(input: {
    body: { userId: string };
    headers: Headers;
  }): Promise<{ user: Parameters<typeof normalizeAdminUserRecord>[0] }>;
  listUserSessions(input: { body: { userId: string }; headers: Headers }): Promise<{
    sessions: Array<Parameters<typeof normalizeAdminSessionRecord>[0]>;
  }>;
  revokeUserSession(input: {
    body: { sessionToken: string };
    headers: Headers;
  }): Promise<{ success: boolean }>;
  revokeUserSessions(input: {
    body: { userId: string };
    headers: Headers;
  }): Promise<{ success: boolean }>;
  revokeSession(input: { body: { token: string }; headers: Headers }): Promise<{
    status: boolean;
  }>;
  revokeOtherSessions(input: { headers: Headers }): Promise<{ status: boolean }>;
  removeUser(input: { body: { userId: string }; headers: Headers }): Promise<{ success: boolean }>;
  setUserPassword(input: {
    body: { newPassword: string; userId: string };
    headers: Headers;
  }): Promise<{ status: boolean }>;
  requestPasswordReset(input: {
    body: { email: string; redirectTo?: string };
    headers: Headers;
  }): Promise<{ message: string; status: boolean }>;
  checkOrganizationSlug(input: {
    body: { slug: string };
    headers: Headers;
  }): Promise<{ status: boolean }>;
  createOrganization(input: {
    body: {
      keepCurrentActiveOrganization?: boolean;
      name: string;
      slug: string;
      userId?: string;
    };
    headers: Headers;
  }): Promise<Parameters<typeof normalizeOrganizationSummaryRecord>[0]>;
  createInvitation(input: {
    body: {
      email: string;
      organizationId: string;
      resend?: boolean;
      role: 'owner' | 'admin' | 'member';
    };
    headers: Headers;
  }): Promise<{ id: string }>;
  updateMemberRole(input: {
    body: {
      memberId: string;
      organizationId: string;
      role: 'owner' | 'admin' | 'member';
    };
    headers: Headers;
  }): Promise<{ member: { id: string } }>;
  removeMember(input: {
    body: { memberIdOrEmail: string; organizationId: string };
    headers: Headers;
  }): Promise<{ member: { id: string } }>;
  cancelInvitation(input: {
    body: { invitationId: string };
    headers: Headers;
  }): Promise<{ id: string }>;
  leaveOrganization(input: {
    body: { organizationId: string };
    headers: Headers;
  }): Promise<{ success: boolean }>;
  updateOrganization(input: {
    body: {
      data: {
        logo?: string;
        name?: string;
      };
      organizationId: string;
    };
    headers: Headers;
  }): Promise<Parameters<typeof normalizeOrganizationSummaryRecord>[0]>;
  deleteOrganization(input: {
    body: { organizationId: string };
    headers: Headers;
  }): Promise<Parameters<typeof normalizeOrganizationSummaryRecord>[0]>;
  setActiveOrganization(input: {
    body: { organizationId?: string | null; organizationSlug?: string };
    headers: Headers;
  }): Promise<Parameters<typeof normalizeOrganizationSummaryRecord>[0] | null>;
  generateSCIMToken(input: {
    body: {
      organizationId: string;
      providerId: string;
    };
    headers: Headers;
  }): Promise<{
    scimToken: string;
  }>;
  listSCIMProviderConnections(input: { headers: Headers }): Promise<{
    providers: Array<{
      id: string;
      organizationId: string | null;
      providerId: string;
    }>;
  }>;
  deleteSCIMProviderConnection(input: {
    body: { providerId: string };
    headers: Headers;
  }): Promise<{ success: boolean }>;
  getSCIMProviderConnection(input: { query: { providerId: string }; headers: Headers }): Promise<{
    id: string;
    organizationId: string | null;
    providerId: string;
  }>;
};

type BetterAuthApiSurface = BetterAuthCoreApiSurface;

type BetterAuthActionContext = {
  auth: {
    api: BetterAuthApiSurface;
  };
  headers: Headers;
};

function normalizeStatusCode(status: string | number | undefined): number {
  if (typeof status === 'string') {
    const parsed = Number.parseInt(status, 10);
    return Number.isNaN(parsed) ? 500 : parsed;
  }

  return typeof status === 'number' ? status : 500;
}

function toTimestamp(value: Date | number | string | undefined | null): number {
  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'string') {
    return new Date(value).getTime();
  }

  return Date.now();
}

function normalizeBetterAuthApiError(error: unknown): BetterAuthActionError {
  if (error instanceof APIError) {
    const errorBody =
      typeof error.body === 'object' && error.body !== null
        ? (error.body as { code?: unknown; message?: unknown })
        : null;

    return {
      code: typeof errorBody?.code === 'string' ? errorBody.code : null,
      message:
        typeof errorBody?.message === 'string'
          ? errorBody.message
          : error.message || 'Better Auth request failed',
      status: normalizeStatusCode(error.status),
    };
  }

  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown; status?: unknown };
    return {
      code: typeof candidate.code === 'string' ? candidate.code : null,
      message: candidate.message || 'Better Auth request failed',
      status: normalizeStatusCode(
        typeof candidate.status === 'string' || typeof candidate.status === 'number'
          ? candidate.status
          : undefined,
      ),
    };
  }

  return {
    code: null,
    message: 'Better Auth request failed',
    status: 500,
  };
}

async function runBetterAuthAction<TData>(
  ctx: ActionCtx,
  execute: (input: BetterAuthActionContext) => Promise<TData>,
): Promise<BetterAuthActionResult<TData>> {
  try {
    const auth = (await authComponent.getAuth(
      createAuth as unknown as ConvexBetterAuthCreateAuth<DataModel>,
      ctx,
    )) as unknown as BetterAuthActionContext;
    return {
      data: await execute(auth),
      ok: true,
    };
  } catch (error) {
    return {
      error: normalizeBetterAuthApiError(error),
      ok: false,
    };
  }
}

async function getCurrentBetterAuthUserOrThrow(ctx: ActionCtx): Promise<{
  email: string | null;
  id: string;
  isSiteAdmin: boolean;
  name: string | null;
}> {
  const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);

  return {
    email: typeof user.authUser.email === 'string' ? user.authUser.email : null,
    id: user.authUserId,
    isSiteAdmin: user.isSiteAdmin,
    name: typeof user.authUser.name === 'string' ? user.authUser.name : null,
  };
}

async function enforceActorScopedServerAuthRateLimit(
  ctx: ActionCtx,
  name:
    | 'adminBanUser'
    | 'adminCreateUser'
    | 'adminGetUser'
    | 'adminListUserSessions'
    | 'adminListUsers'
    | 'adminRemoveUser'
    | 'adminRevokeUserSession'
    | 'adminRevokeUserSessions'
    | 'adminSetRole'
    | 'adminSetUserPassword'
    | 'adminUnbanUser'
    | 'adminUpdateUser',
  scope?: string | null,
): Promise<void> {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
  await enforceServerAuthRateLimit(
    ctx,
    name,
    createActorScopedRateLimitKey({
      actorUserId: currentUser.authUserId,
      ...(scope ? { scope } : {}),
    }),
  );
}

async function enforceCurrentUserScopedServerAuthRateLimit(
  ctx: ActionCtx,
  name: 'currentListSessions' | 'currentRevokeOtherSessions' | 'currentRevokeSession',
  scope?: string | null,
): Promise<void> {
  const currentUser = await getVerifiedCurrentUserFromActionOrThrow(ctx);
  await enforceServerAuthRateLimit(
    ctx,
    name,
    createActorScopedRateLimitKey({
      actorUserId: currentUser.authUserId,
      ...(scope ? { scope } : {}),
    }),
  );
}

async function assertSiteAdminWriteAccess(
  ctx: ActionCtx,
  args: {
    action:
      | 'invite'
      | 'update-member-role'
      | 'remove-member'
      | 'cancel-invitation'
      | 'update-settings'
      | 'delete-organization';
    organizationId: string;
    membershipId?: string;
    nextRole?: 'owner' | 'admin' | 'member';
  },
) {
  const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);

  const access = await ctx.runQuery(anyApi.organizationManagement.getOrganizationWriteAccess, args);
  if (!access.allowed) {
    throw new APIError('FORBIDDEN', {
      message: access.reason ?? 'Organization action not allowed',
    });
  }

  return currentUser;
}

async function assertOrganizationSettingsWriteAccess(ctx: ActionCtx, organizationId: string) {
  const access = await ctx.runQuery(anyApi.organizationManagement.getOrganizationWriteAccess, {
    action: 'update-settings',
    organizationId,
  });

  if (!access.allowed) {
    throw new APIError('FORBIDDEN', {
      message: access.reason ?? 'Organization admin access required',
    });
  }
}

type LocalOrganizationPluginOptions = Pick<
  OrganizationPluginOptions,
  'invitationExpiresIn' | 'organizationHooks' | 'sendInvitationEmail'
>;

function createInvitationPolicyHook(
  ctx: GenericCtx<DataModel>,
): NonNullable<
  NonNullable<LocalOrganizationPluginOptions['organizationHooks']>['beforeCreateInvitation']
> {
  return async ({ invitation, organization }) => {
    const access = await ctx.runQuery(anyApi.organizationManagement.getOrganizationWriteAccess, {
      action: 'invite',
      organizationId: organization.id,
      nextRole: normalizeOrganizationRole(invitation.role),
      email: invitation.email,
      resend: false,
    });

    if (!access.allowed) {
      throw new APIError('FORBIDDEN', {
        message: access.reason ?? 'Organization invitation not allowed',
      });
    }

    return undefined;
  };
}

function createOrganizationPluginOptions(
  ctx: GenericCtx<DataModel>,
): LocalOrganizationPluginOptions {
  return {
    invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS,
    organizationHooks: {
      beforeCreateInvitation: createInvitationPolicyHook(ctx),
    },
    sendInvitationEmail: createSendInvitationEmailHandler(ctx),
  };
}

async function createSiteAdminInvitation(
  ctx: ActionCtx,
  args: {
    email: string;
    organizationId: string;
    resend?: boolean;
    role: 'owner' | 'admin' | 'member';
  },
) {
  const currentUser = await assertSiteAdminWriteAccess(ctx, {
    action: 'invite',
    organizationId: args.organizationId,
  });
  const organization = await findBetterAuthOrganizationById(ctx, args.organizationId);
  if (!organization) {
    throw new APIError('BAD_REQUEST', { message: 'Organization not found' });
  }

  const orgOptions = createOrganizationPluginOptions(ctx);

  const email = args.email.toLowerCase();
  const invitedUser = await findBetterAuthUserByEmail(ctx, email);
  if (invitedUser) {
    const invitedUserId = invitedUser._id ?? invitedUser.id;
    if (invitedUserId) {
      const existingMembership = await findBetterAuthMember(
        ctx,
        args.organizationId,
        invitedUserId,
      );
      if (existingMembership) {
        throw new APIError('BAD_REQUEST', {
          message: 'User is already a member of this organization',
        });
      }
    }
  }

  const pendingInvitations = (
    await fetchBetterAuthInvitationsByOrganizationAndEmail(ctx, args.organizationId, email)
  )
    .filter(
      (invitation) => invitation.email.toLowerCase() === email && invitation.status === 'pending',
    )
    .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));

  if (pendingInvitations.length > 0 && !args.resend) {
    throw new APIError('BAD_REQUEST', { message: 'User is already invited to this organization' });
  }

  const existingInvitation = pendingInvitations[0] ?? null;
  const expiresAt = Date.now() + (orgOptions?.invitationExpiresIn ?? 7 * 24 * 60 * 60) * 1000;
  const invitationSeed = {
    email,
    organizationId: args.organizationId,
    role: args.role,
  };

  if (existingInvitation) {
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'invitation',
        update: {
          expiresAt,
        },
        where: [{ field: '_id', operator: 'eq', value: existingInvitation._id }],
      },
      paginationOpts: { cursor: null, numItems: 1, id: 0 },
    } as never);

    if (orgOptions?.sendInvitationEmail && currentUser.authUser.email) {
      await orgOptions.sendInvitationEmail({
        email,
        id: existingInvitation._id,
        inviter: {
          user: {
            email: currentUser.authUser.email ?? '',
            id: currentUser.authUserId,
            name: currentUser.authUser.name ?? null,
          },
        },
        organization: {
          id: args.organizationId,
          name: organization.name,
        },
        role: args.role,
      } as never);
    }

    return { id: existingInvitation._id };
  }

  let invitationData: typeof invitationSeed & Record<string, unknown> = invitationSeed;
  const hookUser = {
    email: currentUser.authUser.email ?? '',
    id: currentUser.authUserId,
    name: currentUser.authUser.name ?? null,
  };
  if (orgOptions?.organizationHooks?.beforeCreateInvitation) {
    const response = await orgOptions.organizationHooks.beforeCreateInvitation({
      invitation: invitationSeed,
      inviter: hookUser,
      organization: {
        id: args.organizationId,
        name: organization.name,
      },
    } as never);
    if (response?.data) {
      invitationData = {
        ...invitationData,
        ...response.data,
      };
    }
  }

  const createdInvitation = await ctx.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'invitation',
      data: {
        ...invitationData,
        createdAt: Date.now(),
        expiresAt,
        inviterId: currentUser.authUserId,
        status: 'pending',
      },
    },
  });

  const invitationId =
    typeof createdInvitation === 'object' &&
    createdInvitation !== null &&
    '_id' in createdInvitation &&
    typeof createdInvitation._id === 'string'
      ? createdInvitation._id
      : null;
  if (!invitationId) {
    throw new Error('Created invitation is missing an id');
  }

  if (orgOptions?.sendInvitationEmail && currentUser.authUser.email) {
    await orgOptions.sendInvitationEmail({
      email,
      id: invitationId,
      inviter: {
        user: hookUser,
      },
      organization: {
        id: args.organizationId,
        name: organization.name,
      },
      role: args.role,
    } as never);
  }

  if (orgOptions?.organizationHooks?.afterCreateInvitation) {
    await orgOptions.organizationHooks.afterCreateInvitation({
      invitation: {
        email,
        id: invitationId,
        organizationId: args.organizationId,
        role: args.role,
      },
      inviter: hookUser,
      organization: {
        id: args.organizationId,
        name: organization.name,
      },
    } as never);
  }

  return { id: invitationId };
}

async function updateSiteAdminMemberRole(
  ctx: ActionCtx,
  args: {
    memberId: string;
    organizationId: string;
    role: 'owner' | 'admin' | 'member';
  },
) {
  const membership = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'member',
    where: [{ field: '_id', operator: 'eq', value: args.memberId }],
  });
  if (
    !membership ||
    typeof membership !== 'object' ||
    membership === null ||
    !('userId' in membership) ||
    membership.organizationId !== args.organizationId
  ) {
    throw new APIError('BAD_REQUEST', { message: 'Organization member not found' });
  }

  await assertSiteAdminWriteAccess(ctx, {
    action: 'update-member-role',
    organizationId: args.organizationId,
    membershipId: args.memberId,
    nextRole: args.role,
  });

  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'member',
      update: {
        role: args.role,
      },
      where: [{ field: '_id', operator: 'eq', value: args.memberId }],
    },
    paginationOpts: { cursor: null, numItems: 1, id: 0 },
  } as never);

  return {
    member: {
      id: args.memberId,
    },
  };
}

async function removeSiteAdminMember(
  ctx: ActionCtx,
  args: {
    memberIdOrEmail: string;
    organizationId: string;
  },
) {
  const targetMember = args.memberIdOrEmail.includes('@')
    ? await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'member',
        where: [
          { field: 'organizationId', operator: 'eq', value: args.organizationId },
          { field: 'email', operator: 'eq', value: args.memberIdOrEmail, connector: 'AND' },
        ],
      })
    : await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'member',
        where: [{ field: '_id', operator: 'eq', value: args.memberIdOrEmail }],
      });

  const memberId =
    typeof targetMember === 'object' &&
    targetMember !== null &&
    '_id' in targetMember &&
    typeof targetMember._id === 'string'
      ? targetMember._id
      : null;
  if (
    !targetMember ||
    typeof targetMember !== 'object' ||
    targetMember === null ||
    !memberId ||
    !('organizationId' in targetMember) ||
    targetMember.organizationId !== args.organizationId
  ) {
    throw new APIError('BAD_REQUEST', { message: 'Organization member not found' });
  }

  await assertSiteAdminWriteAccess(ctx, {
    action: 'remove-member',
    organizationId: args.organizationId,
    membershipId: memberId,
  });

  await ctx.runMutation(
    components.betterAuth.adapter.deleteOne as never,
    {
      model: 'member',
      id: memberId,
    } as never,
  );

  if (typeof targetMember.userId === 'string') {
    await syncActiveOrganizationForUserSessions(
      ctx as unknown as CtxWithRunMutation,
      targetMember.userId,
      {
        removedOrganizationId: args.organizationId,
      },
    );
  }

  return {
    member: {
      id: memberId,
    },
  };
}

async function cancelSiteAdminInvitation(ctx: ActionCtx, invitationId: string) {
  const invitation = await findBetterAuthInvitationById(ctx, invitationId);
  if (!invitation) {
    throw new APIError('BAD_REQUEST', { message: 'Invitation not found' });
  }

  await assertSiteAdminWriteAccess(ctx, {
    action: 'cancel-invitation',
    organizationId: invitation.organizationId,
  });

  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'invitation',
      update: {
        status: 'canceled',
      },
      where: [{ field: '_id', operator: 'eq', value: invitationId }],
    },
    paginationOpts: { cursor: null, numItems: 1, id: 0 },
  } as never);

  return {
    invitation: {
      id: invitationId,
    },
  };
}

async function updateSiteAdminOrganization(
  ctx: ActionCtx,
  args: {
    data: {
      logo?: string;
      name?: string;
    };
    organizationId: string;
  },
) {
  await assertSiteAdminWriteAccess(ctx, {
    action: 'update-settings',
    organizationId: args.organizationId,
  });

  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'organization',
      update: {
        ...args.data,
      },
      where: [{ field: '_id', operator: 'eq', value: args.organizationId }],
    },
    paginationOpts: { cursor: null, numItems: 1, id: 0 },
  } as never);

  const updatedOrganization = await findBetterAuthOrganizationById(ctx, args.organizationId);
  if (!updatedOrganization) {
    throw new APIError('BAD_REQUEST', { message: 'Organization not found' });
  }

  return normalizeOrganizationSummaryRecord(updatedOrganization);
}

async function deleteSiteAdminOrganization(ctx: ActionCtx, organizationId: string) {
  await assertSiteAdminWriteAccess(ctx, {
    action: 'delete-organization',
    organizationId,
  });

  const organization = await findBetterAuthOrganizationById(ctx, organizationId);
  if (!organization) {
    throw new APIError('BAD_REQUEST', { message: 'Organization not found' });
  }

  const members = await fetchBetterAuthMembersByOrganizationId(ctx, organizationId);
  await ctx.runMutation(
    components.betterAuth.adapter.deleteMany as never,
    {
      input: {
        model: 'invitation',
        where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
      },
      paginationOpts: { cursor: null, numItems: 1000, id: 0 },
    } as never,
  );
  await ctx.runMutation(
    components.betterAuth.adapter.deleteMany as never,
    {
      input: {
        model: 'member',
        where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
      },
      paginationOpts: { cursor: null, numItems: 1000, id: 0 },
    } as never,
  );
  await ctx.runMutation(
    components.betterAuth.adapter.deleteOne as never,
    {
      model: 'organization',
      id: organizationId,
    } as never,
  );

  await Promise.all(
    members.map(async (member) => {
      await syncActiveOrganizationForUserSessions(
        ctx as unknown as CtxWithRunMutation,
        member.userId,
        {
          removedOrganizationId: organizationId,
        },
      );
    }),
  );

  return normalizeOrganizationSummaryRecord(organization);
}

function normalizeAdminUserRecord(record: {
  banExpires?: Date | number | string | null;
  banReason?: string | null;
  banned?: boolean | null;
  createdAt?: Date | number | string;
  email: string;
  emailVerified?: boolean;
  id?: string;
  name?: string | null;
  role?: string | string[] | null;
  updatedAt?: Date | number | string;
  _id?: string;
}): BetterAuthAdminUser {
  const id = record.id ?? record._id;
  if (!id) {
    throw new Error('Better Auth user record is missing an id');
  }

  return {
    banExpires:
      record.banExpires === null || record.banExpires === undefined
        ? null
        : toTimestamp(record.banExpires),
    banReason: record.banReason ?? null,
    banned: record.banned ?? null,
    createdAt: toTimestamp(record.createdAt),
    email: record.email,
    emailVerified: record.emailVerified ?? false,
    id,
    name: record.name ?? null,
    role: record.role ?? null,
    updatedAt: toTimestamp(record.updatedAt),
  };
}

function normalizeAdminSessionRecord(record: {
  createdAt: Date | number | string;
  expiresAt: Date | number | string;
  id: string;
  impersonatedBy?: string;
  ipAddress?: string | null;
  updatedAt: Date | number | string;
  userAgent?: string | null;
  userId: string;
}): BetterAuthAdminSession {
  return {
    createdAt: toTimestamp(record.createdAt),
    expiresAt: toTimestamp(record.expiresAt),
    id: record.id,
    ...(record.impersonatedBy ? { impersonatedBy: record.impersonatedBy } : {}),
    ipAddress: record.ipAddress ?? null,
    updatedAt: toTimestamp(record.updatedAt),
    userAgent: record.userAgent ?? null,
    userId: record.userId,
  };
}

function normalizeCurrentUserSessionRecord(
  record: {
    createdAt: Date | number | string;
    expiresAt: Date | number | string;
    id: string;
    ipAddress?: string | null;
    updatedAt: Date | number | string;
    userAgent?: string | null;
  },
  currentSessionId: string | null,
): BetterAuthCurrentUserSession {
  return {
    createdAt: toTimestamp(record.createdAt),
    expiresAt: toTimestamp(record.expiresAt),
    id: record.id,
    ipAddress: record.ipAddress ?? null,
    isCurrent: record.id === currentSessionId,
    updatedAt: toTimestamp(record.updatedAt),
    userAgent: record.userAgent ?? null,
  };
}

function isActiveSession(
  record: {
    expiresAt: Date | number | string;
  },
  now: number = Date.now(),
) {
  return toTimestamp(record.expiresAt) > now;
}

export function normalizeCurrentUserSessionRecords(
  records: Array<{
    createdAt: Date | number | string;
    expiresAt: Date | number | string;
    id: string;
    ipAddress?: string | null;
    updatedAt: Date | number | string;
    userAgent?: string | null;
  }>,
  currentSessionId: string | null,
  now: number = Date.now(),
): BetterAuthCurrentUserSession[] {
  return records
    .filter((record) => isActiveSession(record, now))
    .map((record) => normalizeCurrentUserSessionRecord(record, currentSessionId))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function findRevocableCurrentUserSession(
  records: Array<{
    createdAt: Date | number | string;
    expiresAt: Date | number | string;
    id: string;
    ipAddress?: string | null;
    token: string;
    updatedAt: Date | number | string;
    userAgent?: string | null;
    userId: string;
  }>,
  sessionId: string,
  now: number = Date.now(),
) {
  return records.find((record) => record.id === sessionId && isActiveSession(record, now)) ?? null;
}

function normalizeOrganizationSummaryRecord(record: {
  id?: string;
  logo?: string | null;
  name?: string;
  slug?: string;
}): BetterAuthOrganizationSummary {
  return {
    ...(record.id ? { id: record.id } : {}),
    ...(record.logo !== undefined ? { logo: record.logo } : {}),
    ...(record.name ? { name: record.name } : {}),
    ...(record.slug ? { slug: record.slug } : {}),
  };
}

const GOOGLE_WORKSPACE_PROVIDER_KEY = 'google-workspace' as const;

function getEnterpriseProviderLabel(providerKey: 'google-workspace' | 'entra' | 'okta'): string {
  switch (providerKey) {
    case 'google-workspace':
      return 'Google Workspace';
    case 'entra':
      return 'Microsoft Entra ID';
    case 'okta':
      return 'Okta';
  }
}

function getOrganizationScimProviderId(
  organizationId: string,
  providerKey: 'google-workspace' | 'entra' | 'okta' = GOOGLE_WORKSPACE_PROVIDER_KEY,
) {
  return `${providerKey}--${organizationId}`;
}

async function _isSiteAdminUser(ctx: GenericCtx<DataModel>, authUserId: string): Promise<boolean> {
  const authUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', operator: 'eq', value: authUserId }],
  });

  if (!authUser || typeof authUser !== 'object') {
    return false;
  }

  const normalizedRole = (authUser as { role?: string | string[] | null }).role ?? undefined;
  return deriveIsSiteAdmin(normalizeUserRole(normalizedRole));
}

type CtxWithRunMutation = GenericCtx<DataModel> & {
  runMutation?: (fn: unknown, args: unknown) => Promise<unknown>;
};

type CtxWithRequiredRunMutation = GenericCtx<DataModel> & {
  runMutation: MutationCtx['runMutation'] | ActionCtx['runMutation'];
};

function normalizeOptionalId(value: string | null | undefined) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

type ParsedScimAuthorization = {
  organizationId: string | null;
  providerId: string;
  rawToken: string;
};

type ParsedScimUserPayload = {
  accountId: string;
  email: string;
  name: string;
};

function createScimErrorBody(status: number, detail: string, scimType?: string) {
  return JSON.stringify({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: status.toString(),
    detail,
    ...(scimType ? { scimType } : {}),
  });
}

function createScimUserResource(
  baseUrl: string,
  input: {
    accountId: string;
    createdAt?: string | number | Date | null;
    email: string;
    name: string;
    updatedAt?: string | number | Date | null;
    userId: string;
  },
) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return {
    id: input.userId,
    externalId: input.accountId,
    meta: {
      resourceType: 'User',
      created: toTimestamp(input.createdAt ?? Date.now()),
      lastModified: toTimestamp(input.updatedAt ?? Date.now()),
      location: new URL(`scim/v2/Users/${input.userId}`, normalizedBaseUrl).toString(),
    },
    userName: input.email,
    name: { formatted: input.name },
    displayName: input.name,
    active: true,
    emails: [
      {
        primary: true,
        value: input.email,
      },
    ],
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  };
}

function normalizeScimPrimaryEmail(userName: string, emails: unknown) {
  if (Array.isArray(emails)) {
    const normalizedEmails = emails.filter(
      (entry): entry is { primary?: boolean; value?: string } =>
        typeof entry === 'object' && entry !== null,
    );
    const primaryEmail = normalizedEmails.find((entry) => entry.primary === true)?.value;
    if (typeof primaryEmail === 'string' && primaryEmail.trim().length > 0) {
      return primaryEmail.trim().toLowerCase();
    }

    const firstEmail = normalizedEmails.find(
      (entry) => typeof entry.value === 'string' && entry.value.trim().length > 0,
    )?.value;
    if (typeof firstEmail === 'string' && firstEmail.trim().length > 0) {
      return firstEmail.trim().toLowerCase();
    }
  }

  return userName.trim().toLowerCase();
}

function normalizeScimFullName(email: string, name: unknown) {
  if (!name || typeof name !== 'object') {
    return email;
  }

  const formatted =
    'formatted' in name && typeof name.formatted === 'string' ? name.formatted.trim() : '';
  if (formatted.length > 0) {
    return formatted;
  }

  const givenName =
    'givenName' in name && typeof name.givenName === 'string' ? name.givenName.trim() : '';
  const familyName =
    'familyName' in name && typeof name.familyName === 'string' ? name.familyName.trim() : '';
  const fullName = [givenName, familyName]
    .filter((segment) => segment.length > 0)
    .join(' ')
    .trim();
  return fullName.length > 0 ? fullName : email;
}

function parseScimUserPayload(bodyJson: string | undefined) {
  if (!bodyJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyJson) as Record<string, unknown>;
    const userName = typeof parsed.userName === 'string' ? parsed.userName.trim() : '';
    if (userName.length === 0) {
      return null;
    }

    const externalId =
      typeof parsed.externalId === 'string' && parsed.externalId.trim().length > 0
        ? parsed.externalId.trim()
        : null;
    const email = normalizeScimPrimaryEmail(userName, parsed.emails);
    const name = normalizeScimFullName(email, parsed.name);

    return {
      accountId: externalId ?? userName,
      email,
      name,
    } satisfies ParsedScimUserPayload;
  } catch {
    return null;
  }
}

function parseScimPatchOperations(bodyJson: string | undefined) {
  if (!bodyJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyJson) as Record<string, unknown>;
    const operations = Array.isArray(parsed.Operations) ? parsed.Operations : [];

    let active: boolean | null = null;
    let hasNonActiveChanges = false;

    for (const operation of operations) {
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      const path = typeof operation.path === 'string' ? operation.path.trim().toLowerCase() : '';
      const value = 'value' in operation ? operation.value : undefined;

      if (path === 'active') {
        if (typeof value === 'boolean') {
          active = value;
          continue;
        }
      }

      if (
        (!path && typeof value === 'object' && value !== null && 'active' in value) ||
        path === 'active'
      ) {
        const nestedActive =
          typeof value === 'object' && value !== null && 'active' in value ? value.active : value;
        if (typeof nestedActive === 'boolean') {
          active = nestedActive;
          continue;
        }
      }

      hasNonActiveChanges = true;
    }

    return {
      active,
      hasNonActiveChanges,
    };
  } catch {
    return null;
  }
}

function decodeScimAuthorizationHeader(
  authorizationHeader: string,
): ParsedScimAuthorization | null {
  const bearerToken = authorizationHeader.replace(/^Bearer\s+/i, '').trim();
  if (bearerToken.length === 0) {
    return null;
  }

  const normalized = bearerToken.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    const decoded = atob(padded);
    const [rawToken, providerId, ...organizationParts] = decoded.split(':');
    if (!rawToken || !providerId) {
      return null;
    }

    const organizationId = organizationParts.join(':').trim();
    return {
      rawToken,
      providerId,
      organizationId: organizationId.length > 0 ? organizationId : null,
    };
  } catch {
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashScimToken(scimToken: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scimToken));
  return encodeBase64Url(new Uint8Array(digest));
}

async function syncActiveOrganizationForUserSessions(
  ctx: CtxWithRunMutation,
  authUserId: string,
  options: {
    preferredOrganizationId?: string | null;
    removedOrganizationId?: string | null;
    updateOnlyWhenMissing?: boolean;
  } = {},
) {
  if (!ctx.runMutation) {
    return;
  }

  const ctxWithRequiredRunMutation = ctx as CtxWithRequiredRunMutation;

  const sessions = await fetchBetterAuthSessionsByUserId(ctx, authUserId);
  if (sessions.length === 0) {
    return;
  }

  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  const membershipStatuses = await getOrganizationMembershipStatuses(
    ctx,
    memberships.map((membership) => membership._id),
  );
  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const validOrganizationIds = new Set(
    memberships
      .filter((membership) => (membershipStatuses.get(membership._id) ?? 'active') === 'active')
      .map((membership) => membership.organizationId)
      .filter((organizationId) =>
        organizations.some(
          (organization) => (organization._id ?? organization.id) === organizationId,
        ),
      ),
  );

  const nextOrganizationId =
    (await resolveInitialActiveOrganizationId(ctx, authUserId, options.preferredOrganizationId)) ??
    null;
  const removedOrganizationId = normalizeOptionalId(options.removedOrganizationId);

  await Promise.all(
    sessions.map(async (session) => {
      const currentOrganizationId = normalizeOptionalId(session.activeOrganizationId);
      const hasValidCurrentOrganization =
        currentOrganizationId !== null && validOrganizationIds.has(currentOrganizationId);
      const shouldUpdate =
        removedOrganizationId !== null
          ? currentOrganizationId === removedOrganizationId
          : options.updateOnlyWhenMissing
            ? !hasValidCurrentOrganization
            : !hasValidCurrentOrganization;

      if (!shouldUpdate) {
        return;
      }

      await updateBetterAuthSessionRecord(ctxWithRequiredRunMutation, session._id, {
        activeOrganizationId: nextOrganizationId,
      });
    }),
  );
}

async function clearEnterpriseOrganizationForUserSessions(
  ctx: CtxWithRunMutation,
  authUserId: string,
  organizationId: string,
) {
  if (!ctx.runMutation) {
    return;
  }

  const sessions = await fetchBetterAuthSessionsByUserId(ctx, authUserId);
  await Promise.all(
    sessions.map(async (session) => {
      if (normalizeOptionalId(session.enterpriseOrganizationId) !== organizationId) {
        return;
      }

      await updateBetterAuthSessionRecord(ctx as CtxWithRequiredRunMutation, session._id, {
        authMethod: 'social',
        enterpriseOrganizationId: null,
        enterpriseProviderKey: null,
        enterpriseProtocol: null,
      });
    }),
  );
}

async function resolveScimProviderFromAuthorizationHeader(
  ctx: GenericCtx<DataModel>,
  authorizationHeader: string,
) {
  const parsed = decodeScimAuthorizationHeader(authorizationHeader);
  if (!parsed) {
    return null;
  }

  const scimProvider =
    parsed.organizationId !== null
      ? await findBetterAuthScimProviderByOrganizationId(ctx, parsed.organizationId)
      : await findBetterAuthScimProviderById(ctx, parsed.providerId);

  if (!scimProvider || scimProvider.providerId !== parsed.providerId) {
    return null;
  }

  if (scimProvider.scimToken !== (await hashScimToken(parsed.rawToken))) {
    return null;
  }

  return {
    organizationId: parsed.organizationId,
    providerId: parsed.providerId,
    scimProvider,
  };
}

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  const ctxWithRunMutation = ctx as CtxWithRunMutation;
  const deletedOrganizationMembers = new Map<string, string[]>();

  const recordAuditEvent = async (event: {
    eventType: string;
    userId?: string;
    actorUserId?: string;
    targetUserId?: string;
    organizationId?: string;
    identifier?: string;
    sessionId?: string;
    requestId?: string;
    outcome?: 'success' | 'failure';
    severity?: 'info' | 'warning' | 'critical';
    resourceType?: string;
    resourceId?: string;
    resourceLabel?: string;
    sourceSurface?: string;
    metadata?: string;
    ipAddress?: string;
    userAgent?: string;
    createdAt?: number;
  }) => {
    if (!ctxWithRunMutation.runMutation) {
      return;
    }

    await ctxWithRunMutation.runMutation(anyApi.audit.insertAuditLog, {
      ...event,
    });
  };

  const sharedOptions = createSharedBetterAuthOptions({
    allowUserToCreateOrganization: async (user) => {
      return await canUserSelfServeCreateOrganization(ctx, user);
    },
    afterSCIMTokenGenerated: async ({ organizationId, providerId, userId }) => {
      await recordAuditEvent({
        createdAt: Date.now(),
        eventType: 'enterprise_scim_token_generated',
        identifier: providerId,
        metadata: JSON.stringify({
          organizationId,
          providerId,
          userId,
        }),
        organizationId: organizationId ?? undefined,
        userId,
      });
    },
    assertSCIMManagementAccess: async ({ organizationId, providerId, userId }) => {
      await assertScimManagementAccess(ctx, {
        organizationId,
        providerId,
        userId,
      });
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const activeOrganizationId = normalizeOptionalId(
              typeof session.activeOrganizationId === 'string'
                ? session.activeOrganizationId
                : null,
            );
            if (activeOrganizationId) {
              return;
            }

            const nextOrganizationId = await resolveInitialActiveOrganizationId(
              ctx,
              session.userId,
            );
            if (!nextOrganizationId) {
              return;
            }

            return {
              data: {
                ...session,
                activeOrganizationId: nextOrganizationId,
              },
            };
          },
        },
      },
    },
    organizationHooks: {
      beforeCreateInvitation: createInvitationPolicyHook(ctx),
      beforeAcceptInvitation: async ({ organization }) => {
        const access = await ctx.runQuery(
          anyApi.organizationManagement.getOrganizationMemberJoinAccess,
          {
            organizationId: organization.id,
          },
        );

        if (!access.allowed) {
          throw new APIError('FORBIDDEN', {
            message: access.reason ?? 'Organization join not allowed',
          });
        }
      },
      afterAddMember: async ({ member }) => {
        await syncActiveOrganizationForUserSessions(ctxWithRunMutation, member.userId, {
          preferredOrganizationId: member.organizationId,
          updateOnlyWhenMissing: true,
        });
      },
      beforeDeleteOrganization: async ({ organization }) => {
        const members = await fetchBetterAuthMembersByOrganizationId(ctx, organization.id);
        deletedOrganizationMembers.set(
          organization.id,
          members.map((member) => member.userId),
        );
      },
      afterDeleteOrganization: async ({ organization }) => {
        const affectedUserIds = deletedOrganizationMembers.get(organization.id) ?? [];
        deletedOrganizationMembers.delete(organization.id);

        await Promise.all(
          affectedUserIds.map(async (authUserId) => {
            await syncActiveOrganizationForUserSessions(ctxWithRunMutation, authUserId, {
              removedOrganizationId: organization.id,
            });
          }),
        );
      },
      afterRemoveMember: async ({ member }) => {
        await syncActiveOrganizationForUserSessions(ctxWithRunMutation, member.userId, {
          removedOrganizationId: member.organizationId,
        });
      },
    },
    resolveEnterpriseAuthSession: async ({ providerId, userEmail, userId }) => {
      const enterpriseSession = await resolveEnterpriseSessionContext(ctx, {
        providerId,
        userEmail,
        userId,
      });
      if (!enterpriseSession) {
        return null;
      }

      await recordAuditEvent({
        createdAt: Date.now(),
        eventType: 'enterprise_login_succeeded',
        identifier: userEmail.toLowerCase(),
        metadata: JSON.stringify({
          providerKey: enterpriseSession.providerKey,
          providerLabel: getEnterpriseProviderLabel(enterpriseSession.providerKey),
        }),
        organizationId: enterpriseSession.organizationId,
        userId,
      });

      return enterpriseSession;
    },
    sendResetPassword: createSendResetPasswordHandler(ctx),
    sendChangeEmailConfirmation: createSendChangeEmailConfirmationHandler(ctx),
    sendVerificationEmail: createSendVerificationEmailHandler(ctx),
    afterEmailVerification: async (user) => {
      if (!ctxWithRunMutation.runMutation) {
        return;
      }

      await ctxWithRunMutation.runMutation(internal.users.syncAuthUserProfile, {
        authUserId: user.id,
      });
    },
    sendInvitationEmail: createSendInvitationEmailHandler(ctx),
    shouldBlockPasswordAuth: async ({ email }) => {
      return await getPasswordAuthBlockMessage(ctx, email);
    },
  });

  return betterAuth({
    ...sharedOptions,
    logger: {
      disabled: optionsOnly,
    },
    secret,
    database: authComponent.adapter(ctx),
    plugins: [...(sharedOptions.plugins ?? []), createAuthAuditPlugin(recordAuditEvent)],
  });
};

export type BetterAuthInstance = ReturnType<typeof createAuth>;
export type BetterAuthSessionInfer = NonNullable<BetterAuthInstance['$Infer']['Session']>;
export type BetterAuthSessionUser = BetterAuthSessionInfer['user'];
export type BetterAuthSessionData = BetterAuthSessionInfer['session'];

type RotatedJwk = {
  alg?: string;
  createdAt?: Date | number | string;
  expiresAt?: Date | number | string;
  id: string;
  privateKey: string;
  publicKey: string;
};

const isRotatedJwk = (value: unknown): value is RotatedJwk => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const isTimestampLike = (timestamp: unknown) =>
    timestamp === undefined ||
    typeof timestamp === 'string' ||
    typeof timestamp === 'number' ||
    timestamp instanceof Date;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.privateKey === 'string' &&
    typeof candidate.publicKey === 'string' &&
    (candidate.alg === undefined || typeof candidate.alg === 'string') &&
    isTimestampLike(candidate.createdAt) &&
    isTimestampLike(candidate.expiresAt)
  );
};

const parseRotatedJwks = (value: unknown): RotatedJwk[] => {
  if (!Array.isArray(value) || !value.every(isRotatedJwk)) {
    throw new Error('Invalid JWKS response from Better Auth');
  }

  return value;
};

// Action wrapper for rate limiting (callable from server functions)
export const rateLimitAction = internalAction({
  args: {
    name: v.string(),
    key: v.string(),
    config: v.union(
      v.object({
        kind: v.literal('token bucket'),
        rate: v.number(),
        period: v.number(),
        capacity: v.number(),
      }),
      v.object({
        kind: v.literal('fixed window'),
        rate: v.number(),
        period: v.number(),
        capacity: v.number(),
      }),
    ),
  },
  returns: rateLimitResultValidator,
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.rateLimiter.lib.rateLimit, args);
  },
});

export const enforcePdfParseRateLimit = action({
  args: {},
  returns: rateLimitResultValidator,
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError('Authentication required.');
    }

    const userId = assertUserId(authUser, 'User ID not found in auth user');
    const result = await ctx.runMutation(components.rateLimiter.lib.rateLimit, {
      name: 'pdfParse',
      key: `pdfParse:${userId}`,
      config: {
        kind: 'token bucket',
        rate: 10,
        period: 5 * 60 * 1000,
        capacity: 10,
      },
    });

    if (!result.ok) {
      throw new ConvexError(
        `PDF parsing rate limit exceeded. Try again in ${Math.max(
          1,
          Math.ceil((result.retryAfter ?? 0) / 1000),
        )} seconds.`,
      );
    }

    return result;
  },
});

export const getCurrentSessionServer = action({
  args: {},
  returns: betterAuthActionResultValidator(betterAuthCurrentSessionValidator),
  handler: async (ctx) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      const result = await auth.api.getSession({
        headers,
        query: {
          disableCookieCache: true,
        },
      });

      return result?.session
        ? {
            session: {
              createdAt: toTimestamp(result.session.createdAt),
              updatedAt: toTimestamp(result.session.updatedAt ?? null),
            },
          }
        : null;
    });
  },
});

export const listCurrentSessions = action({
  args: {},
  returns: betterAuthActionResultValidator(currentUserSessionsValidator),
  handler: async (ctx) => {
    // Keep this wrapper intentionally thin: rate-limit, read the native Better Auth
    // session state, and minimally normalize timestamps plus current-session identity.
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceCurrentUserScopedServerAuthRateLimit(ctx, 'currentListSessions');
      const [currentSession, sessions] = await Promise.all([
        auth.api.getSession({
          headers,
          query: {
            disableCookieCache: true,
          },
        }),
        auth.api.listSessions({
          headers,
        }),
      ]);

      const currentSessionId = currentSession?.session?.id ?? null;
      return normalizeCurrentUserSessionRecords(sessions, currentSessionId);
    });
  },
});

export const revokeCurrentSessionById = action({
  args: {
    sessionId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    // Resolve the public Better Auth session id back to the native token through
    // Better Auth's own listSessions() response instead of adapter table lookups.
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceCurrentUserScopedServerAuthRateLimit(
        ctx,
        'currentRevokeSession',
        args.sessionId,
      );
      const sessions = await auth.api.listSessions({
        headers,
      });

      const sessionRecord = findRevocableCurrentUserSession(sessions, args.sessionId);

      if (!sessionRecord) {
        throw new APIError('NOT_FOUND', { message: 'Session not found' });
      }

      const response = await auth.api.revokeSession({
        body: {
          token: sessionRecord.token,
        },
        headers,
      });

      return {
        success: response.status,
      };
    });
  },
});

export const revokeCurrentOtherSessions = action({
  args: {},
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    // Delegate directly to Better Auth so self-service revoke semantics stay aligned
    // with the auth layer rather than reimplementing delete logic in Convex.
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceCurrentUserScopedServerAuthRateLimit(ctx, 'currentRevokeOtherSessions');
      const response = await auth.api.revokeOtherSessions({
        headers,
      });

      return {
        success: response.status,
      };
    });
  },
});

export const adminListUsers = action({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      limit: v.optional(v.number()),
      offset: v.optional(v.number()),
      total: v.number(),
      users: v.array(betterAuthAdminUserValidator),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminListUsers');
      const response = await auth.api.listUsers({
        headers,
        query: {
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.offset !== undefined ? { offset: args.offset } : {}),
        },
      });

      return {
        ...(response.limit !== undefined ? { limit: response.limit } : {}),
        ...(response.offset !== undefined ? { offset: response.offset } : {}),
        total: response.total,
        users: response.users.map((user) => normalizeAdminUserRecord(user)),
      };
    });
  },
});

export const adminGetUser = action({
  args: {
    id: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthAdminUserValidator),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminGetUser', args.id);
      const response = await auth.api.getUser({
        headers,
        query: { id: args.id },
      });

      return normalizeAdminUserRecord(response);
    });
  },
});

export const adminCreateUser = action({
  args: {
    email: v.string(),
    name: v.string(),
    password: v.optional(v.string()),
    role: v.optional(v.union(v.literal('admin'), v.literal('user'))),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      user: betterAuthAdminUserValidator,
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminCreateUser', args.email);
      const response = await auth.api.createUser({
        body: args,
        headers,
      });

      return {
        user: normalizeAdminUserRecord(response.user),
      };
    });
  },
});

export const adminUpdateUser = action({
  args: {
    data: v.object({
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      phoneNumber: v.optional(v.union(v.string(), v.null())),
    }),
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthAdminUserValidator),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminUpdateUser', args.userId);
      const response = await auth.api.adminUpdateUser({
        body: args,
        headers,
      });

      return normalizeAdminUserRecord(response);
    });
  },
});

export const adminSetRole = action({
  args: {
    role: v.union(v.literal('admin'), v.literal('user')),
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      user: betterAuthAdminUserValidator,
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminSetRole', args.userId);
      const response = await auth.api.setRole({
        body: args,
        headers,
      });

      return {
        user: normalizeAdminUserRecord(response.user),
      };
    });
  },
});

export const adminBanUser = action({
  args: {
    banExpiresIn: v.optional(v.number()),
    banReason: v.optional(v.string()),
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      user: betterAuthAdminUserValidator,
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminBanUser', args.userId);
      const response = await auth.api.banUser({
        body: args,
        headers,
      });

      return {
        user: normalizeAdminUserRecord(response.user),
      };
    });
  },
});

export const adminUnbanUser = action({
  args: {
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      user: betterAuthAdminUserValidator,
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminUnbanUser', args.userId);
      const response = await auth.api.unbanUser({
        body: args,
        headers,
      });

      return {
        user: normalizeAdminUserRecord(response.user),
      };
    });
  },
});

export const adminListUserSessions = action({
  args: {
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      sessions: v.array(betterAuthAdminSessionValidator),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminListUserSessions', args.userId);
      const response = await auth.api.listUserSessions({
        body: args,
        headers,
      });

      return {
        sessions: response.sessions.map((session) => normalizeAdminSessionRecord(session)),
      };
    });
  },
});

export const adminRevokeUserSession = action({
  args: {
    sessionId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminRevokeUserSession', args.sessionId);
      const sessionRecord = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'session',
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: args.sessionId,
          },
        ],
      })) as { token?: string } | null;

      if (!sessionRecord?.token) {
        throw new APIError('NOT_FOUND', { message: 'Session not found' });
      }

      return await auth.api.revokeUserSession({
        body: {
          sessionToken: sessionRecord.token,
        },
        headers,
      });
    });
  },
});

export const resolvePasswordResetEmail = action({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.object({
      email: v.string(),
      found: v.literal(true),
    }),
    v.object({
      found: v.literal(false),
    }),
  ),
  handler: async (ctx, args) => {
    const verification = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'verification',
      where: [
        {
          field: 'identifier',
          operator: 'eq',
          value: `reset-password:${args.token}`,
        },
        {
          field: 'expiresAt',
          operator: 'gt',
          value: Date.now(),
        },
      ],
    })) as { value?: string } | null;

    if (!verification?.value) {
      return { found: false } as const;
    }

    const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [
        {
          field: '_id',
          operator: 'eq',
          value: verification.value,
        },
      ],
    })) as { email?: string | null } | null;

    if (!authUser?.email) {
      return { found: false } as const;
    }

    return {
      found: true as const,
      email: authUser.email,
    };
  },
});

export const adminRevokeUserSessions = action({
  args: {
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminRevokeUserSessions', args.userId);
      return await auth.api.revokeUserSessions({
        body: args,
        headers,
      });
    });
  },
});

export const adminRemoveUser = action({
  args: {
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminRemoveUser', args.userId);
      return await auth.api.removeUser({
        body: args,
        headers,
      });
    });
  },
});

export const adminSetUserPassword = action({
  args: {
    newPassword: v.string(),
    userId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      status: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceActorScopedServerAuthRateLimit(ctx, 'adminSetUserPassword', args.userId);
      return await auth.api.setUserPassword({
        body: args,
        headers,
      });
    });
  },
});

export const requestPasswordResetServer = action({
  args: {
    email: v.string(),
    redirectTo: v.optional(v.string()),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      message: v.string(),
      status: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      await enforceServerAuthRateLimit(
        ctx,
        'requestPasswordReset',
        createEmailScopedRateLimitKey(args.email),
      );
      return await auth.api.requestPasswordReset({
        body: args,
        headers,
      });
    });
  },
});

export const checkOrganizationSlugServer = action({
  args: {
    slug: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      status: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      return await auth.api.checkOrganizationSlug({
        body: args,
        headers,
      });
    });
  },
});

export const createOrganizationServer = action({
  args: {
    keepCurrentActiveOrganization: v.optional(v.boolean()),
    name: v.string(),
    slug: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthOrganizationSummaryValidator),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      const response = await auth.api.createOrganization({
        body: args,
        headers,
      });

      return normalizeOrganizationSummaryRecord(response);
    });
  },
});

export const createOrganizationInvitationServer = action({
  args: {
    email: v.string(),
    organizationId: v.string(),
    resend: v.optional(v.boolean()),
    role: organizationRoleValidator,
  },
  returns: betterAuthActionResultValidator(
    v.object({
      id: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
    const viewerMembership = await findBetterAuthMember(ctx, args.organizationId, currentUser.id);

    if (!currentUser.isSiteAdmin || viewerMembership) {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        const response = await auth.api.createInvitation({
          body: args,
          headers,
        });

        return { id: response.id };
      });
    }

    try {
      return {
        ok: true as const,
        data: await createSiteAdminInvitation(ctx, args),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const updateOrganizationMemberRoleServer = action({
  args: {
    memberId: v.string(),
    organizationId: v.string(),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
  },
  returns: betterAuthActionResultValidator(betterAuthOrganizationMemberResultValidator),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
    const viewerMembership = await findBetterAuthMember(ctx, args.organizationId, currentUser.id);

    if (!currentUser.isSiteAdmin || viewerMembership) {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        const response = await auth.api.updateMemberRole({
          body: args,
          headers,
        });

        return {
          member: {
            id: response.member.id,
          },
        };
      });
    }

    try {
      return {
        ok: true as const,
        data: await updateSiteAdminMemberRole(ctx, args),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const removeOrganizationMemberServer = action({
  args: {
    memberIdOrEmail: v.string(),
    organizationId: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthOrganizationMemberResultValidator),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
    const viewerMembership = await findBetterAuthMember(ctx, args.organizationId, currentUser.id);

    if (!currentUser.isSiteAdmin || viewerMembership) {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        const response = await auth.api.removeMember({
          body: args,
          headers,
        });

        return {
          member: {
            id: response.member.id,
          },
        };
      });
    }

    try {
      return {
        ok: true as const,
        data: await removeSiteAdminMember(ctx, args),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const cancelOrganizationInvitationServer = action({
  args: {
    invitationId: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthOrganizationInvitationResultValidator),
  handler: async (ctx, args) => {
    const invitation = await findBetterAuthInvitationById(ctx, args.invitationId);
    const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
    const viewerMembership = invitation
      ? await findBetterAuthMember(ctx, invitation.organizationId, currentUser.id)
      : null;

    if (!currentUser.isSiteAdmin || viewerMembership) {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        const response = await auth.api.cancelInvitation({
          body: args,
          headers,
        });

        return {
          invitation: {
            id: response.id,
          },
        };
      });
    }

    try {
      return {
        ok: true as const,
        data: await cancelSiteAdminInvitation(ctx, args.invitationId),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const leaveOrganizationServer = action({
  args: {
    organizationId: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      return await auth.api.leaveOrganization({
        body: args,
        headers,
      });
    });
  },
});

export const updateOrganizationServer = action({
  args: {
    data: v.object({
      logo: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    organizationId: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthOrganizationSummaryValidator),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
    const viewerMembership = await findBetterAuthMember(ctx, args.organizationId, currentUser.id);

    if (!currentUser.isSiteAdmin || viewerMembership) {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        const response = await auth.api.updateOrganization({
          body: args,
          headers,
        });

        return normalizeOrganizationSummaryRecord(response);
      });
    }

    try {
      return {
        ok: true as const,
        data: await updateSiteAdminOrganization(ctx, args),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const deleteOrganizationServer = action({
  args: {
    organizationId: v.string(),
  },
  returns: betterAuthActionResultValidator(betterAuthOrganizationSummaryValidator),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
    const viewerMembership = await findBetterAuthMember(ctx, args.organizationId, currentUser.id);

    if (!currentUser.isSiteAdmin || viewerMembership) {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        const response = await auth.api.deleteOrganization({
          body: args,
          headers,
        });

        return normalizeOrganizationSummaryRecord(response);
      });
    }

    try {
      return {
        ok: true as const,
        data: await deleteSiteAdminOrganization(ctx, args.organizationId),
      };
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const generateOrganizationScimTokenServer = action({
  args: {
    organizationId: v.string(),
    providerKey: enterpriseProviderKeyValidator,
  },
  returns: betterAuthActionResultValidator(betterAuthScimTokenResultValidator),
  handler: async (ctx, args) => {
    if (args.providerKey !== GOOGLE_WORKSPACE_PROVIDER_KEY || !isGoogleWorkspaceOAuthConfigured()) {
      return {
        ok: false as const,
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message: 'Google Workspace enterprise auth is not configured.',
          status: 400,
        },
      };
    }

    try {
      await assertOrganizationSettingsWriteAccess(ctx, args.organizationId);

      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        return await auth.api.generateSCIMToken({
          body: {
            organizationId: args.organizationId,
            providerId: getOrganizationScimProviderId(args.organizationId, args.providerKey),
          },
          headers,
        });
      });
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const listOrganizationScimProvidersServer = action({
  args: {},
  returns: betterAuthActionResultValidator(betterAuthScimProviderListValidator),
  handler: async (ctx) => {
    try {
      return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        return await auth.api.listSCIMProviderConnections({
          headers,
        });
      });
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const deleteOrganizationScimProviderServer = action({
  args: {
    organizationId: v.string(),
    providerKey: enterpriseProviderKeyValidator,
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    try {
      await assertOrganizationSettingsWriteAccess(ctx, args.organizationId);

      const providerId = getOrganizationScimProviderId(args.organizationId, args.providerKey);
      const result = await runBetterAuthAction(ctx, async ({ auth, headers }) => {
        return await auth.api.deleteSCIMProviderConnection({
          body: {
            providerId,
          },
          headers,
        });
      });

      if (result.ok) {
        const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
        await ctx.runMutation(anyApi.audit.insertAuditLog, {
          createdAt: Date.now(),
          eventType: 'enterprise_scim_token_deleted',
          identifier: providerId,
          metadata: JSON.stringify({
            organizationId: args.organizationId,
            providerKey: args.providerKey,
          }),
          organizationId: args.organizationId,
          userId: currentUser.id,
        });
      }

      return result;
    } catch (error) {
      return {
        ok: false as const,
        error: normalizeBetterAuthApiError(error),
      };
    }
  },
});

export const handleScimOrganizationLifecycleInternal = internalAction({
  args: {
    authorizationHeader: v.string(),
    baseUrl: v.string(),
    bodyJson: v.optional(v.string()),
    operation: scimLifecycleOperationValidator,
    userId: v.optional(v.string()),
  },
  returns: scimLifecycleResponseValidator,
  handler: async (ctx, args) => {
    const scimContext = await resolveScimProviderFromAuthorizationHeader(
      ctx,
      args.authorizationHeader,
    );
    if (!scimContext) {
      return {
        handled: true,
        status: 401,
        location: null,
        body: createScimErrorBody(401, 'Invalid SCIM token'),
      };
    }

    if (!scimContext.organizationId) {
      return {
        handled: true,
        status: 400,
        location: null,
        body: createScimErrorBody(400, 'Organization-scoped SCIM token required'),
      };
    }

    const organizationId = scimContext.organizationId;

    const recordScimAuditEvent = async (input: {
      eventType: string;
      identifier?: string;
      metadata?: Record<string, unknown>;
      userId?: string;
    }) => {
      await ctx.runMutation(internal.audit.insertAuditLog, {
        createdAt: Date.now(),
        eventType: input.eventType,
        identifier: input.identifier,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        organizationId,
        userId: input.userId,
      });
    };

    const resolveUserRecord = async (userId: string | undefined) => {
      if (!userId) {
        return null;
      }

      return (await fetchBetterAuthUsersByIds(ctx, [userId]))[0] ?? null;
    };

    const deprovisionMembership = async (userId: string | undefined) => {
      if (!userId) {
        return;
      }

      const user = await resolveUserRecord(userId);
      const membership = await findBetterAuthMember(ctx, organizationId, userId);
      if (!membership) {
        return;
      }

      try {
        await deleteBetterAuthMemberRecord(ctx as CtxWithRequiredRunMutation, membership._id);
        await ctx.runMutation(
          internal.scimLifecycle.markOrganizationMembershipDeactivatedForUserInternal,
          {
            membershipId: membership._id,
            organizationId,
            reason: 'SCIM deprovisioned membership',
            userId,
          },
        );
        await syncActiveOrganizationForUserSessions(ctx as unknown as CtxWithRunMutation, userId, {
          removedOrganizationId: organizationId,
        });
        await clearEnterpriseOrganizationForUserSessions(
          ctx as unknown as CtxWithRunMutation,
          userId,
          organizationId,
        );
        await recordScimAuditEvent({
          eventType: 'scim_member_deprovisioned',
          identifier: user?.email?.toLowerCase(),
          metadata: {
            actorType: 'scim',
            providerId: scimContext.providerId,
            targetMembershipId: membership._id,
            targetUserId: userId,
          },
          userId,
        });
      } catch (error) {
        await recordScimAuditEvent({
          eventType: 'scim_member_deprovision_failed',
          identifier: user?.email?.toLowerCase(),
          metadata: {
            actorType: 'scim',
            error: error instanceof Error ? error.message : 'Unknown SCIM deprovision error',
            providerId: scimContext.providerId,
            targetMembershipId: membership._id,
            targetUserId: userId,
          },
          userId,
        });
        throw error;
      }
    };

    const ensureMembership = async (input: {
      payload?: ParsedScimUserPayload | null;
      userId?: string;
    }) => {
      const existingAccount = input.payload?.accountId
        ? await findBetterAuthAccountByAccountIdAndProviderId(
            ctx,
            input.payload.accountId,
            scimContext.providerId,
          )
        : input.userId
          ? await findBetterAuthAccountByUserIdAndProviderId(
              ctx,
              input.userId,
              scimContext.providerId,
            )
          : null;

      if (!existingAccount) {
        return null;
      }

      const user = (await fetchBetterAuthUsersByIds(ctx, [existingAccount.userId]))[0] ?? null;
      if (!user) {
        return null;
      }

      const existingMembership = await findBetterAuthMember(
        ctx,
        organizationId,
        existingAccount.userId,
      );

      if (!existingMembership) {
        const existingState = await getOrganizationMembershipStateByOrganizationUser(
          ctx,
          organizationId,
          existingAccount.userId,
        );
        await createBetterAuthMember(ctx as CtxWithRequiredRunMutation, {
          organizationId,
          userId: existingAccount.userId,
          role: 'member',
          createdAt: Date.now(),
        });
        await ctx.runMutation(
          internal.scimLifecycle.clearOrganizationMembershipStatesForUserInternal,
          {
            organizationId,
            userId: existingAccount.userId,
          },
        );
        await recordScimAuditEvent({
          eventType: 'scim_member_reactivated',
          identifier: user.email?.toLowerCase(),
          metadata: {
            actorType: 'scim',
            previousStatus: existingState?.status ?? null,
            providerId: scimContext.providerId,
            targetUserId: existingAccount.userId,
          },
          userId: existingAccount.userId,
        });
      }

      if (input.payload) {
        await Promise.all([
          updateBetterAuthUserRecord(
            ctx as CtxWithRequiredRunMutation,
            user._id ?? existingAccount.userId,
            {
              email: input.payload.email,
              name: input.payload.name,
            },
          ),
          updateBetterAuthAccountRecord(ctx as CtxWithRequiredRunMutation, existingAccount._id, {
            accountId: input.payload.accountId,
          }),
        ]);
      }

      const nextUser = input.payload
        ? {
            ...user,
            email: input.payload.email,
            name: input.payload.name,
          }
        : user;
      const nextAccount = input.payload
        ? {
            ...existingAccount,
            accountId: input.payload.accountId,
          }
        : existingAccount;

      return {
        account: nextAccount,
        hadMembership: existingMembership !== null,
        user: nextUser,
      };
    };

    if (args.operation === 'delete') {
      await deprovisionMembership(args.userId);
      return {
        handled: true,
        status: 204,
        location: null,
        body: null,
      };
    }

    if (args.operation === 'patch') {
      const patch = parseScimPatchOperations(args.bodyJson);
      if (!patch || patch.active === null) {
        return {
          handled: false,
          status: 200,
          location: null,
          body: null,
        };
      }

      if (patch.active === false) {
        await deprovisionMembership(args.userId);
        return {
          handled: true,
          status: 204,
          location: null,
          body: null,
        };
      }

      await ensureMembership({
        userId: args.userId,
      });

      return {
        handled: !patch.hasNonActiveChanges,
        status: 204,
        location: null,
        body: null,
      };
    }

    if (args.operation === 'put') {
      const ensured = await ensureMembership({
        userId: args.userId,
      });

      if (!ensured || ensured.hadMembership) {
        return {
          handled: false,
          status: 200,
          location: null,
          body: null,
        };
      }

      return {
        handled: false,
        status: 200,
        location: null,
        body: null,
      };
    }

    const payload = parseScimUserPayload(args.bodyJson);
    if (!payload) {
      return {
        handled: false,
        status: 200,
        location: null,
        body: null,
      };
    }

    const ensured = await ensureMembership({
      payload,
    });
    if (!ensured || ensured.hadMembership) {
      return {
        handled: false,
        status: 200,
        location: null,
        body: null,
      };
    }

    const resource = createScimUserResource(args.baseUrl, {
      accountId: ensured.account.accountId,
      createdAt: ensured.user.createdAt,
      email: ensured.user.email,
      name: ensured.user.name ?? ensured.user.email,
      updatedAt: ensured.user.updatedAt,
      userId: ensured.user._id ?? ensured.user.id ?? ensured.account.userId,
    });

    return {
      handled: true,
      status: 201,
      location: resource.meta.location,
      body: JSON.stringify(resource),
    };
  },
});

export const rotateKeys = internalAction({
  args: {},
  returns: v.string(),
  handler: async (ctx, args) => {
    void args;
    const auth = createAuth(ctx);
    const jwksResult: unknown = await (
      auth.api as unknown as {
        rotateKeys: () => Promise<unknown>;
      }
    ).rotateKeys();
    const jwks = parseRotatedJwks(jwksResult);
    return JSON.stringify(
      jwks.map((key: RotatedJwk) => ({
        ...key,
        createdAt:
          key.createdAt instanceof Date ? key.createdAt.getTime() : (key.createdAt ?? Date.now()),
        expiresAt:
          key.expiresAt instanceof Date ? key.expiresAt.getTime() : (key.expiresAt ?? undefined),
      })),
    );
  },
});
