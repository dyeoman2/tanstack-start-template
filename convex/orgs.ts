import { v } from 'convex/values';
import { getSiteUrl } from '../src/lib/server/env.server';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { action, mutation, query } from './_generated/server';
import {
  buildCurrentUserProfile,
  checkOrganizationAccess,
  getCurrentUserOrNull,
  getCurrentUserOrThrow,
  isAdminRole,
  listOrganizationMembers,
} from './auth/access';
import { organizationQuery } from './auth/authorized';
import { throwConvexError } from './auth/errors';
import { authComponent } from './auth';
import {
  type BetterAuthInvitation,
  type BetterAuthMember,
  createBetterAuthInvitation,
  createBetterAuthMember,
  createBetterAuthOrganization,
  fetchAllBetterAuthUsers,
  fetchBetterAuthInvitationsByOrganizationId,
  fetchBetterAuthOrganizationsByIds,
  fetchBetterAuthUsersByIds,
  findBetterAuthInvitationById,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
} from './lib/betterAuth';

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function isInviteExpired(invite: BetterAuthInvitation) {
  const expiresAt =
    typeof invite.expiresAt === 'number'
      ? invite.expiresAt
      : invite.expiresAt instanceof Date
        ? invite.expiresAt.getTime()
        : invite.expiresAt
          ? new Date(invite.expiresAt).getTime()
          : 0;
  return expiresAt <= Date.now();
}

async function getOrganizationOrThrow(ctx: QueryCtx | MutationCtx, organizationId: string) {
  const organization = await findBetterAuthOrganizationById(ctx, organizationId);
  if (!organization) {
    throwConvexError('NOT_FOUND', 'Organization not found');
  }

  return organization;
}

async function requireOrganizationAdminAccess(ctx: MutationCtx, organizationId: string) {
  const user = await getCurrentUserOrThrow(ctx);
  const access = user.isSiteAdmin
    ? { admin: true, edit: true, view: true, delete: true, siteAdmin: true }
    : await checkOrganizationAccess(ctx, organizationId, { user });

  if (!access.admin) {
    throwConvexError('ADMIN_REQUIRED', 'Admin access required for this organization');
  }

  const organization = await getOrganizationOrThrow(ctx, organizationId);
  return { user, organization };
}

async function listMembersWithAuthUsers(ctx: QueryCtx | MutationCtx, organizationId: string) {
  const memberships = await listOrganizationMembers(ctx, organizationId);
  const authUsers = await fetchBetterAuthUsersByIds(
    ctx,
    memberships.map((membership) => membership.userId),
  );
  const authUsersById = new Map(authUsers.map((user) => [user.id ?? user._id ?? '', user]));

  return memberships.map((membership) => {
    const authUser = authUsersById.get(membership.userId);
    return {
      membershipId: membership._id ?? '',
      authUserId: membership.userId,
      email: authUser?.email ?? '',
      name: authUser?.name ?? null,
      role: membership.role,
      isSiteAdmin: authUser ? isAdminRole(authUser.role) : false,
    };
  });
}

async function generateUniqueSlug(ctx: QueryCtx | MutationCtx, name: string) {
  const baseSlug = slugify(name) || 'organization';
  let slug = baseSlug;
  let suffix = 1;

  while (true) {
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: 'slug', operator: 'eq', value: slug }],
    });

    if (!existing) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

export const listMyOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      return {
        currentOrganizationId: null,
        organizations: [],
      };
    }

    const profile = await buildCurrentUserProfile(ctx, user);
    return {
      currentOrganizationId: profile.currentOrganization?.id ?? null,
      organizations: profile.organizations,
    };
  },
});

export const getCurrentOrganization = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user?.lastActiveOrganizationId) {
      return null;
    }

    const organization = await findBetterAuthOrganizationById(ctx, user.lastActiveOrganizationId);
    if (!organization) {
      return null;
    }

    const access = await checkOrganizationAccess(ctx, organization._id ?? user.lastActiveOrganizationId, {
      user,
    });
    if (!access.view) {
      return null;
    }

    return {
      id: organization._id ?? user.lastActiveOrganizationId,
      name: organization.name,
      access,
    };
  },
});

export const getOrganizationDetails = organizationQuery(async (ctx) => {
  const organization = await getOrganizationOrThrow(ctx, ctx.organizationId);
  const members = await listMembersWithAuthUsers(ctx, ctx.organizationId);
  const invites = await fetchBetterAuthInvitationsByOrganizationId(ctx, ctx.organizationId);

  return {
    organization: {
      id: organization._id ?? ctx.organizationId,
      name: organization.name,
      slug: organization.slug,
    },
    access: ctx.access,
    members,
    invites: invites.map((invite) => ({
      id: invite._id ?? '',
      email: invite.email,
      role: invite.role,
      status: isInviteExpired(invite) && invite.status === 'pending' ? 'expired' : invite.status,
      expiresAt:
        typeof invite.expiresAt === 'number'
          ? invite.expiresAt
          : invite.expiresAt instanceof Date
            ? invite.expiresAt.getTime()
            : invite.expiresAt
              ? new Date(invite.expiresAt).getTime()
              : Date.now(),
      createdAt:
        typeof invite.createdAt === 'number'
          ? invite.createdAt
          : invite.createdAt instanceof Date
            ? invite.createdAt.getTime()
            : invite.createdAt
              ? new Date(invite.createdAt).getTime()
              : Date.now(),
    })),
  };
});

export const createOrganization = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throwConvexError('VALIDATION', 'Organization name is required');
    }

    const now = Date.now();
    const slug = await generateUniqueSlug(ctx, trimmedName);
    const organization = await createBetterAuthOrganization(ctx, {
      name: trimmedName,
      slug,
      createdAt: now,
    });
    const organizationId = organization._id ?? organization.id;
    if (!organizationId) {
      throw new Error('Failed to create organization');
    }

    await createBetterAuthMember(ctx, {
      organizationId,
      userId: user.authUserId,
      role: 'owner',
      createdAt: now,
    });

    await ctx.db.patch(user._id, {
      lastActiveOrganizationId: organizationId,
      updatedAt: now,
    });

    return {
      organizationId,
    };
  },
});

export const setActiveOrganization = mutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const access = await checkOrganizationAccess(ctx, args.organizationId, { user });
    if (!access.view) {
      throwConvexError('FORBIDDEN', 'Not authorized to access this organization');
    }

    await ctx.db.patch(user._id, {
      lastActiveOrganizationId: args.organizationId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const renameOrganization = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrganizationAdminAccess(ctx, args.organizationId);
    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throwConvexError('VALIDATION', 'Organization name is required');
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'organization',
        update: {
          name: trimmedName,
        },
        where: [{ field: '_id', operator: 'eq', value: args.organizationId }],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        id: 0,
      },
    });

    return { success: true };
  },
});

export const createInvitation = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const { user, organization } = await requireOrganizationAdminAccess(ctx, args.organizationId);
    const normalizedEmail = normalizeEmail(args.email);
    const existingInvites = await fetchBetterAuthInvitationsByOrganizationId(ctx, args.organizationId);
    const activeInvite = existingInvites.find(
      (invite) =>
        invite.email.toLowerCase() === normalizedEmail &&
        invite.status === 'pending' &&
        !isInviteExpired(invite),
    );
    if (activeInvite) {
      throwConvexError('VALIDATION', 'An active invite already exists for this email');
    }

    const now = Date.now();
    const invitation = await createBetterAuthInvitation(ctx, {
      organizationId: args.organizationId,
      email: normalizedEmail,
      role: args.role,
      status: 'pending',
      inviterId: user.authUserId,
      expiresAt: now + INVITE_EXPIRY_MS,
      createdAt: now,
    });

    const invitationId = invitation._id ?? invitation.id;
    if (!invitationId) {
      throw new Error('Failed to create invitation');
    }

    await ctx.scheduler.runAfter(0, internal.emails.sendOrganizationInviteEmailMutation, {
      email: normalizedEmail,
      inviteUrl: `${getSiteUrl()}/invite/${invitationId}`,
      inviterName: user.authUser.name ?? user.authUser.email ?? 'An organization admin',
      organizationName: organization.name,
      role: args.role,
    });

    return { invitationId };
  },
});

export const getInvitePreview = query({
  args: {
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const invite = await findBetterAuthInvitationById(ctx, args.invitationId);
    if (!invite) {
      return null;
    }

    const organization = await findBetterAuthOrganizationById(ctx, invite.organizationId);
    if (!organization) {
      return null;
    }

    return {
      email: invite.email,
      role: invite.role,
      status: isInviteExpired(invite) && invite.status === 'pending' ? 'expired' : invite.status,
      organization: {
        id: organization._id ?? invite.organizationId,
        name: organization.name,
      },
      expiresAt:
        typeof invite.expiresAt === 'number'
          ? invite.expiresAt
          : invite.expiresAt instanceof Date
            ? invite.expiresAt.getTime()
            : invite.expiresAt
              ? new Date(invite.expiresAt).getTime()
              : Date.now(),
    };
  },
});

export const acceptInvitation = mutation({
  args: {
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const invite = await findBetterAuthInvitationById(ctx, args.invitationId);
    if (!invite) {
      throwConvexError('NOT_FOUND', 'Invite not found');
    }

    if (invite.status !== 'pending') {
      throwConvexError('VALIDATION', 'This invite is no longer pending');
    }

    if (isInviteExpired(invite)) {
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'invitation',
          update: { status: 'canceled' },
          where: [{ field: '_id', operator: 'eq', value: args.invitationId }],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1,
          id: 0,
        },
      });
      throwConvexError('VALIDATION', 'This invite has expired');
    }

    const email = normalizeEmail(currentUser.authUser.email ?? '');
    if (email !== normalizeEmail(invite.email)) {
      throwConvexError('FORBIDDEN', 'This invite was sent to a different email address');
    }

    const existingMembership = await findBetterAuthMember(
      ctx,
      invite.organizationId,
      currentUser.authUserId,
    );
    if (!existingMembership) {
      await createBetterAuthMember(ctx, {
        organizationId: invite.organizationId,
        userId: currentUser.authUserId,
        role: invite.role,
        createdAt: Date.now(),
      });
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'invitation',
        update: { status: 'accepted' },
        where: [{ field: '_id', operator: 'eq', value: args.invitationId }],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        id: 0,
      },
    });

    await ctx.db.patch(currentUser._id, {
      lastActiveOrganizationId: invite.organizationId,
      updatedAt: Date.now(),
    });

    const organization = await getOrganizationOrThrow(ctx, invite.organizationId);
    return {
      success: true,
      organizationName: organization.name,
    };
  },
});

export const revokeInvitation = mutation({
  args: {
    organizationId: v.string(),
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrganizationAdminAccess(ctx, args.organizationId);
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'invitation',
        update: { status: 'canceled' },
        where: [
          { field: '_id', operator: 'eq', value: args.invitationId },
          { field: 'organizationId', operator: 'eq', value: args.organizationId, connector: 'AND' },
        ],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        id: 0,
      },
    });

    return { success: true };
  },
});

export const updateMemberRole = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrganizationAdminAccess(ctx, args.organizationId);
    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      throwConvexError('NOT_FOUND', 'Organization member not found');
    }

    if (membership.userId === user.authUserId && membership.role === 'owner') {
      throwConvexError('VALIDATION', 'The organization owner role cannot be changed');
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
        update: { role: args.role },
        where: [{ field: '_id', operator: 'eq', value: args.membershipId }],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        id: 0,
      },
    });

    return { success: true };
  },
});

export const removeMember = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOrganizationAdminAccess(ctx, args.organizationId);
    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      throwConvexError('NOT_FOUND', 'Organization member not found');
    }

    if (membership.userId === user.authUserId) {
      throwConvexError('VALIDATION', 'You cannot remove yourself from the active organization');
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'member',
        where: [{ field: '_id', operator: 'eq', value: args.membershipId }],
      },
    });

    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', membership.userId))
      .first();
    if (appUser?.lastActiveOrganizationId === args.organizationId) {
      const remainingMemberships = await fetchBetterAuthOrganizationsByIds(
        ctx,
        (await fetchAllBetterAuthUsers(ctx), await listOrganizationMembers(ctx, args.organizationId)).map(
          () => args.organizationId,
        ),
      );
      await ctx.db.patch(appUser._id, {
        lastActiveOrganizationId: remainingMemberships[0]?._id,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

export const backfillAllUsersAndOrganizations = action({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser || !isAdminRole((authUser as { role?: string | string[] }).role)) {
      throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
    }

    const authUsers = await fetchAllBetterAuthUsers(ctx);
    let processed = 0;

    for (const authUser of authUsers) {
      const authUserId = authUser.id ?? authUser._id;
      if (!authUserId) {
        continue;
      }

      await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
        authUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      processed += 1;
    }

    return { success: true, processed };
  },
});
