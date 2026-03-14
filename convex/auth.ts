import {
  createClient,
  type CreateAuth as ConvexBetterAuthCreateAuth,
  type GenericCtx,
} from '@convex-dev/better-auth';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { anyApi } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  getBetterAuthSecret,
  getSiteUrl,
  isTrustedBetterAuthOrigin,
} from '../src/lib/server/env.server';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { action, internalAction, mutation, query } from './_generated/server';
import betterAuthSchema from './betterAuth/schema';
import {
  createSharedBetterAuthOptions,
  type SharedSendInvitationEmail,
} from './betterAuth/sharedOptions';
import {
  findBetterAuthInvitationById,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
  findBetterAuthUserByEmail,
  fetchBetterAuthMembersByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  fetchBetterAuthInvitationsByOrganizationId,
  fetchBetterAuthSessionsByUserId,
  updateBetterAuthSessionRecord,
} from './lib/betterAuth';
import { createAuthAuditPlugin } from './lib/authAudit';
import { authUserValidator, rateLimitResultValidator } from './lib/returnValidators';

const secret = getBetterAuthSecret();

function resolveAuthEmailUrl(url: string, request?: Request): string {
  let canonicalUrl: URL;

  try {
    canonicalUrl = new URL(url, getSiteUrl());
  } catch {
    return url;
  }

  if (!request) {
    return canonicalUrl.toString();
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    if (!isTrustedBetterAuthOrigin(requestOrigin)) {
      return canonicalUrl.toString();
    }

    const nextOrigin = new URL(requestOrigin);
    canonicalUrl.protocol = nextOrigin.protocol;
    canonicalUrl.host = nextOrigin.host;
    return canonicalUrl.toString();
  } catch {
    return canonicalUrl.toString();
  }
}

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
const betterAuthActionSuccessValidator = <TValidator extends ReturnType<typeof v.object> | ReturnType<typeof v.union> | ReturnType<typeof v.array> | ReturnType<typeof v.literal> | ReturnType<typeof v.string> | ReturnType<typeof v.boolean> | ReturnType<typeof v.number>>(dataValidator: TValidator) =>
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
  token: v.string(),
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

const betterAuthActionResultValidator = <TValidator extends ReturnType<typeof v.object> | ReturnType<typeof v.union> | ReturnType<typeof v.array> | ReturnType<typeof v.literal> | ReturnType<typeof v.string> | ReturnType<typeof v.boolean> | ReturnType<typeof v.number>>(dataValidator: TValidator) =>
  v.union(betterAuthActionSuccessValidator(dataValidator), betterAuthActionFailureValidator);

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
  token: string;
  updatedAt: number;
  userAgent: string | null;
  userId: string;
};

type BetterAuthOrganizationSummary = {
  id?: string;
  logo?: string | null;
  name?: string;
  slug?: string;
};

type BetterAuthApiSurface = {
  listUsers(input: {
    headers: Headers;
    query?: { limit?: number; offset?: number };
  }): Promise<{
    limit?: number;
    offset?: number;
    total: number;
    users: Array<Parameters<typeof normalizeAdminUserRecord>[0]>;
  }>;
  getUser(input: { headers: Headers; query: { id: string } }): Promise<
    Parameters<typeof normalizeAdminUserRecord>[0]
  >;
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
  listUserSessions(input: {
    body: { userId: string };
    headers: Headers;
  }): Promise<{
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
  removeUser(input: {
    body: { userId: string };
    headers: Headers;
  }): Promise<{ success: boolean }>;
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
      role: 'admin' | 'member';
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
};

type BetterAuthActionContext = {
  auth: {
    api: BetterAuthApiSurface;
  };
  headers: Headers;
};

type BetterAuthAuthUser = {
  email?: string;
  id?: string;
  name?: string | null;
  role?: string | string[] | null;
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

function slugifyOrganizationName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function createDefaultOrganizationSlug(authUserId: string, now: number): string {
  return `${slugifyOrganizationName(`org-${authUserId.slice(0, 8)}`)}-${now.toString(36)}`;
}

async function getCurrentBetterAuthUserOrThrow(ctx: ActionCtx): Promise<{
  email: string | null;
  id: string;
  isSiteAdmin: boolean;
  name: string | null;
}> {
  const authUser = (await authComponent.getAuthUser(ctx)) as BetterAuthAuthUser | null;
  if (!authUser?.id) {
    throw APIError.fromStatus('UNAUTHORIZED', { message: 'Not authenticated' });
  }

  return {
    email: typeof authUser.email === 'string' ? authUser.email : null,
    id: authUser.id,
    isSiteAdmin: deriveIsSiteAdmin(normalizeUserRole(authUser.role ?? undefined)),
    name: typeof authUser.name === 'string' ? authUser.name : null,
  };
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
  const currentUser = await getCurrentBetterAuthUserOrThrow(ctx);
  if (!currentUser.isSiteAdmin) {
    throw new APIError('FORBIDDEN', { message: 'Organization admin access required' });
  }

  const access = await ctx.runQuery(anyApi.organizationManagement.getOrganizationWriteAccess, args);
  if (!access.allowed) {
    throw new APIError('FORBIDDEN', {
      message: access.reason ?? 'Organization action not allowed',
    });
  }

  return currentUser;
}

async function createSystemOrganizationForUser(
  ctx: ActionCtx,
  input: {
    authUserId: string;
    name?: string;
    now: number;
  },
): Promise<{ id: string }> {
  const auth = createAuth(ctx);
  const response = await ((auth.api as unknown) as BetterAuthApiSurface).createOrganization({
    body: {
      keepCurrentActiveOrganization: false,
      name: input.name ?? 'New Organization',
      slug: createDefaultOrganizationSlug(input.authUserId, input.now),
      userId: input.authUserId,
    },
    headers: new Headers(),
  });

  const normalized = normalizeOrganizationSummaryRecord(response);
  if (!normalized.id) {
    throw new Error('Created organization is missing an id');
  }

  return { id: normalized.id };
}

async function createDefaultOrganizationForCurrentUser(
  ctx: ActionCtx,
  authUserId: string,
): Promise<{ id: string }> {
  return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
    const response = await auth.api.createOrganization({
      body: {
        keepCurrentActiveOrganization: false,
        name: 'New Organization',
        slug: createDefaultOrganizationSlug(authUserId, Date.now()),
      },
      headers,
    });

    const normalized = normalizeOrganizationSummaryRecord(response);
    if (!normalized.id) {
      throw new Error('Created organization is missing an id');
    }

    return { id: normalized.id };
  }).then((result) => {
    if (!result.ok) {
      throw new APIError(result.error.status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST', {
        message: result.error.message,
      });
    }

    return result.data;
  });
}

async function createSiteAdminInvitation(
  ctx: ActionCtx,
  args: {
    email: string;
    organizationId: string;
    resend?: boolean;
    role: 'admin' | 'member';
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

  const auth = createAuth(ctx, { optionsOnly: true }) as any;
  const orgOptions = ((auth.options?.plugins ?? []).find((plugin: any) => plugin.id === 'organization')
    ?.options ?? {}) as {
    invitationExpiresIn?: number;
    organizationHooks?: {
      afterCreateInvitation?: (input: any) => Promise<void>;
      beforeCreateInvitation?: (input: any) => Promise<{ data?: Record<string, unknown> } | void>;
    };
    sendInvitationEmail?: SharedSendInvitationEmail;
  };

  const email = args.email.toLowerCase();
  const invitedUser = await findBetterAuthUserByEmail(ctx, email);
  if (invitedUser) {
    const invitedUserId = invitedUser._id ?? invitedUser.id;
    if (invitedUserId) {
      const existingMembership = await findBetterAuthMember(ctx, args.organizationId, invitedUserId);
      if (existingMembership) {
        throw new APIError('BAD_REQUEST', {
          message: 'User is already a member of this organization',
        });
      }
    }
  }

  const pendingInvitations = (await fetchBetterAuthInvitationsByOrganizationId(ctx, args.organizationId))
    .filter((invitation) => invitation.email.toLowerCase() === email && invitation.status === 'pending')
    .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));

  if (pendingInvitations.length > 0 && !args.resend) {
    throw new APIError('BAD_REQUEST', { message: 'User is already invited to this organization' });
  }

  const existingInvitation = pendingInvitations[0] ?? null;
  const expiresAt = Date.now() + ((orgOptions?.invitationExpiresIn ?? 7 * 24 * 60 * 60) * 1000);
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

    if (orgOptions?.sendInvitationEmail && currentUser.email) {
      await orgOptions.sendInvitationEmail({
        email,
        id: existingInvitation._id,
        inviter: {
          user: {
            email: currentUser.email ?? '',
            id: currentUser.id,
            name: currentUser.name,
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
    email: currentUser.email ?? '',
    id: currentUser.id,
    name: currentUser.name,
  };
  if (orgOptions?.organizationHooks?.beforeCreateInvitation) {
    const response = await orgOptions.organizationHooks.beforeCreateInvitation({
      invitation: invitationSeed,
      organization: {
        id: args.organizationId,
        name: organization.name,
      },
      user: hookUser,
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
        inviterId: currentUser.id,
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

  if (orgOptions?.sendInvitationEmail && currentUser.email) {
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
      organization: {
        id: args.organizationId,
        name: organization.name,
      },
      user: hookUser,
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
  const targetMember =
    args.memberIdOrEmail.includes('@')
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

  await ctx.runMutation((components.betterAuth.adapter.deleteOne as never), {
    model: 'member',
    id: memberId,
  } as never);

  if (typeof targetMember.userId === 'string') {
    await syncActiveOrganizationForUserSessions((ctx as unknown) as CtxWithRunMutation, targetMember.userId, {
      removedOrganizationId: args.organizationId,
    });
  }

  return {
    member: {
      id: memberId,
    },
  };
}

async function cancelSiteAdminInvitation(
  ctx: ActionCtx,
  invitationId: string,
) {
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

async function deleteSiteAdminOrganization(
  ctx: ActionCtx,
  organizationId: string,
) {
  await assertSiteAdminWriteAccess(ctx, {
    action: 'delete-organization',
    organizationId,
  });

  const organization = await findBetterAuthOrganizationById(ctx, organizationId);
  if (!organization) {
    throw new APIError('BAD_REQUEST', { message: 'Organization not found' });
  }

  const members = await fetchBetterAuthMembersByOrganizationId(ctx, organizationId);
  await ctx.runMutation((components.betterAuth.adapter.deleteMany as never), {
    input: {
      model: 'invitation',
      where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
    },
    paginationOpts: { cursor: null, numItems: 1000, id: 0 },
  } as never);
  await ctx.runMutation((components.betterAuth.adapter.deleteMany as never), {
    input: {
      model: 'member',
      where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
    },
    paginationOpts: { cursor: null, numItems: 1000, id: 0 },
  } as never);
  await ctx.runMutation((components.betterAuth.adapter.deleteOne as never), {
    model: 'organization',
    id: organizationId,
  } as never);

  await Promise.all(
    members.map(async (member) => {
      await syncActiveOrganizationForUserSessions((ctx as unknown) as CtxWithRunMutation, member.userId, {
        removedOrganizationId: organizationId,
      });
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
  token: string;
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
    token: record.token,
    updatedAt: toTimestamp(record.updatedAt),
    userAgent: record.userAgent ?? null,
    userId: record.userId,
  };
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

type CtxWithRunMutation = GenericCtx<DataModel> & {
  runMutation?: (fn: unknown, args: unknown) => Promise<unknown>;
};

type CtxWithRequiredRunMutation = GenericCtx<DataModel> & {
  runMutation: MutationCtx['runMutation'] | ActionCtx['runMutation'];
};

function normalizeOptionalId(value: string | null | undefined) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function resolvePreferredActiveOrganizationId(
  ctx: GenericCtx<DataModel>,
  authUserId: string,
  preferredOrganizationId?: string | null,
) {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  if (memberships.length === 0) {
    return null;
  }

  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const organizationIds = new Set(
    organizations.map((organization) => organization._id ?? organization.id).filter(Boolean),
  );

  const normalizedPreferredOrganizationId = normalizeOptionalId(preferredOrganizationId);
  if (normalizedPreferredOrganizationId && organizationIds.has(normalizedPreferredOrganizationId)) {
    return normalizedPreferredOrganizationId;
  }

  return memberships
    .filter((membership) => organizationIds.has(membership.organizationId))
    .sort((left, right) => {
      const leftCreatedAt = typeof left.createdAt === 'number' ? left.createdAt : left._creationTime;
      const rightCreatedAt =
        typeof right.createdAt === 'number' ? right.createdAt : right._creationTime;

      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }

      return left.organizationId.localeCompare(right.organizationId);
    })[0]?.organizationId;
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
  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const validOrganizationIds = new Set(
    organizations.map((organization) => organization._id ?? organization.id).filter(Boolean),
  );

  const nextOrganizationId =
    (await resolvePreferredActiveOrganizationId(
      ctx,
      authUserId,
      options.preferredOrganizationId,
    )) ?? null;
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

export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { optionsOnly } = { optionsOnly: false },
) => {
  const ctxWithRunMutation = ctx as CtxWithRunMutation;
  const deletedOrganizationMembers = new Map<string, string[]>();

  const recordAuditEvent = async (event: {
    eventType: string;
    userId?: string;
    organizationId?: string;
    identifier?: string;
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
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const activeOrganizationId = normalizeOptionalId(
              typeof session.activeOrganizationId === 'string' ? session.activeOrganizationId : null,
            );
            if (activeOrganizationId) {
              return;
            }

            const nextOrganizationId = await resolvePreferredActiveOrganizationId(
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
    sendResetPassword: async ({ user, url, token }, request) => {
      // Apply server-side rate limiting for password reset (defense-in-depth)
      const ctxWithRunMutation = ctx as GenericCtx<DataModel> & {
        runMutation?: (fn: unknown, args: unknown) => Promise<{ ok: boolean; retryAfter?: number }>;
      };

      if (!ctxWithRunMutation.runMutation) {
        throw new Error('Rate limiter mutation unavailable in current context');
      }

      const rateLimitResult = await ctxWithRunMutation.runMutation(
        components.rateLimiter.lib.rateLimit,
        {
          name: 'passwordReset',
          key: `passwordReset:${user.email}`,
          config: {
            kind: 'token bucket',
            rate: 3, // 3 requests
            period: 60 * 60 * 1000, // per hour
            capacity: 3,
          },
        },
      );

      if (!rateLimitResult.ok) {
        throw new Error(
          `Rate limit exceeded. Too many password reset requests. Please try again in ${Math.ceil(
            (rateLimitResult.retryAfter ?? 0) / (60 * 1000),
          )} minutes.`,
        );
      }

      // Call the email action which schedules the mutation using the Resend component
      // This ensures queueing, batching, durable execution, and rate limiting
      // We need to call it via the HTTP API since Better Auth callbacks don't have direct access to ctx.runAction
      // For now, schedule the internal mutation directly if ctx has scheduler
      // Better Auth callbacks run in Convex context, so ctx should have scheduler
      // Use type assertion since GenericCtx might not expose scheduler in types
      // Using unknown instead of any for better type safety
      const ctxWithScheduler = ctx as GenericCtx<DataModel> & {
        scheduler?: {
          runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
        };
      };
      if (ctxWithScheduler.scheduler) {
        await ctxWithScheduler.scheduler.runAfter(
          0,
          internal.emails.sendPasswordResetEmailMutation,
          {
            user: {
              id: user.id,
              email: user.email,
              name: user.name || null,
            },
            url: resolveAuthEmailUrl(url, request),
            token,
          },
        );
      } else {
        // Fallback: if no scheduler, we could call the action via HTTP
        // But this is an edge case - Better Auth should provide scheduler
        throw new Error('Cannot send email: scheduler not available');
      }
    },
    sendVerificationEmail: async ({ user, url, token }, request) => {
      const ctxWithScheduler = ctx as GenericCtx<DataModel> & {
        scheduler?: {
          runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
        };
      };

      if (!ctxWithScheduler.scheduler) {
        throw new Error('Cannot send verification email: scheduler not available');
      }

      await ctxWithScheduler.scheduler.runAfter(0, internal.emails.sendVerificationEmailMutation, {
        user: {
          id: user.id,
          email: user.email,
          name: user.name || null,
        },
        url: resolveAuthEmailUrl(url, request),
        token,
      });
    },
    afterEmailVerification: async (user) => {
      if (!ctxWithRunMutation.runMutation) {
        return;
      }

      await ctxWithRunMutation.runMutation(internal.users.syncAuthUserProfile, {
        authUserId: user.id,
      });
    },
    sendInvitationEmail: async (
      data: Parameters<SharedSendInvitationEmail>[0],
      request?: Request,
    ) => {
      const ctxWithScheduler = ctx as GenericCtx<DataModel> & {
        scheduler?: {
          runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
        };
      };

      if (!ctxWithScheduler.scheduler) {
        throw new Error('Cannot send organization invitation email: scheduler not available');
      }

      const inviteUrl = resolveAuthEmailUrl(`/invite/${data.id}`, request);
      await ctxWithScheduler.scheduler.runAfter(
        0,
        internal.emails.sendOrganizationInviteEmailMutation,
        {
          email: data.email,
          inviteUrl,
          inviterName: data.inviter.user.name ?? data.inviter.user.email,
          organizationName: data.organization.name,
          role: data.role,
        },
      );
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

export const enforcePdfParseRateLimit = mutation({
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
    sessionToken: v.string(),
  },
  returns: betterAuthActionResultValidator(
    v.object({
      success: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await runBetterAuthAction(ctx, async ({ auth, headers }) => {
      return await auth.api.revokeUserSession({
        body: args,
        headers,
      });
    });
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
    role: v.union(v.literal('admin'), v.literal('member')),
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

export const getCurrentUser = query({
  args: {},
  returns: v.union(authUserValidator, v.null()),
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
