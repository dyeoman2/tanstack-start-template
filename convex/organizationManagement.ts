import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { getSiteUrl } from '../src/lib/server/env.server';
import {
  canChangeMemberRole,
  canManageOrganization,
  canRemoveMember,
  deriveViewerRole,
  getAssignableRoles,
  normalizeOrganizationRole,
  type OrganizationRole,
  type OrganizationViewerRole,
} from '../src/features/organizations/lib/organization-permissions';
import { components, internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import {
  checkOrganizationAccess,
  getVerifiedCurrentUserOrThrow,
  listOrganizationMembers,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import {
  createBetterAuthInvitation,
  fetchAllBetterAuthOrganizations,
  fetchBetterAuthInvitationsByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  fetchBetterAuthUsersByIds,
  findBetterAuthUserByEmail,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
  findBetterAuthOrganizationBySlug,
} from './lib/betterAuth';

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
type OrganizationDirectorySortField = 'name' | 'email' | 'kind' | 'role' | 'status' | 'createdAt';
type OrganizationDirectorySortDirection = 'asc' | 'desc';

type OrganizationAccessContext = {
  access: Awaited<ReturnType<typeof checkOrganizationAccess>>;
  organization: NonNullable<Awaited<ReturnType<typeof findBetterAuthOrganizationById>>>;
  user: Awaited<ReturnType<typeof getVerifiedCurrentUserOrThrow>>;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
  viewerRole: OrganizationViewerRole;
};

type OrganizationMemberRow = {
  id: string;
  kind: 'member';
  membershipId: string;
  authUserId: string;
  name: string | null;
  email: string;
  role: OrganizationRole;
  status: 'active';
  createdAt: number;
  isSiteAdmin: boolean;
  availableRoles: OrganizationRole[];
  canChangeRole: boolean;
  canRemove: boolean;
};

type OrganizationInvitationRow = {
  id: string;
  kind: 'invite';
  invitationId: string;
  name: null;
  email: string;
  role: Extract<OrganizationRole, 'admin' | 'member'>;
  status: 'pending' | 'expired';
  createdAt: number;
  expiresAt: number;
  canRevoke: boolean;
};

type OrganizationDirectoryRow = OrganizationMemberRow | OrganizationInvitationRow;

function toTimestamp(value: string | number | Date | undefined | null): number {
  if (!value) {
    return Date.now();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isInvitationExpired(expiresAt: string | number | Date | undefined | null) {
  return toTimestamp(expiresAt) <= Date.now();
}

async function getOrganizationAccessContextBySlug(ctx: QueryCtx, slug: string) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const organization = await findBetterAuthOrganizationBySlug(ctx, slug);
  if (!organization) {
    return null;
  }

  const organizationId = organization._id ?? organization.id;
  if (!organizationId) {
    throw new Error('Organization is missing an id');
  }

  const [access, viewerMembership] = await Promise.all([
    checkOrganizationAccess(ctx, organizationId, { user }),
    findBetterAuthMember(ctx, organizationId, user.authUserId),
  ]);

  const viewerRole = deriveViewerRole({
    isSiteAdmin: user.isSiteAdmin,
    membershipRole: viewerMembership?.role,
  });

  return {
    user,
    organization,
    access,
    viewerMembership,
    viewerRole,
  } satisfies OrganizationAccessContext;
}

async function requireOrganizationManagerById(ctx: MutationCtx, organizationId: string) {
  const user = await getVerifiedCurrentUserOrThrow(ctx);
  const organization = await findBetterAuthOrganizationById(ctx, organizationId);
  if (!organization) {
    throwConvexError('NOT_FOUND', 'Organization not found');
  }

  const [access, viewerMembership] = await Promise.all([
    checkOrganizationAccess(ctx, organizationId, { user }),
    findBetterAuthMember(ctx, organizationId, user.authUserId),
  ]);

  const viewerRole = deriveViewerRole({
    isSiteAdmin: user.isSiteAdmin,
    membershipRole: viewerMembership?.role,
  });
  const canManage = canManageOrganization(viewerRole);

  if (!canManage) {
    throwConvexError('FORBIDDEN', 'Organization admin access required');
  }

  return {
    user,
    organization,
    access,
    viewerMembership,
    viewerRole,
  } satisfies OrganizationAccessContext;
}

function compareValues(
  left: string | number,
  right: string | number,
  direction: OrganizationDirectorySortDirection,
) {
  if (left === right) {
    return 0;
  }

  if (direction === 'asc') {
    return left > right ? 1 : -1;
  }

  return left < right ? 1 : -1;
}

function sortValue(
  row: OrganizationDirectoryRow,
  field: OrganizationDirectorySortField,
): string | number {
  switch (field) {
    case 'name':
      return row.name?.toLowerCase() ?? '';
    case 'email':
      return row.email.toLowerCase();
    case 'kind':
      return row.kind;
    case 'role':
      return row.role;
    case 'status':
      return row.status;
    default:
      return row.createdAt;
  }
}

async function repairUserContexts(ctx: MutationCtx, authUserIds: string[]) {
  const uniqueAuthUserIds = [...new Set(authUserIds)];
  const users = await Promise.all(
    uniqueAuthUserIds.map(async (authUserId) => {
      return await ctx.db
        .query('users')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
        .first();
    }),
  );

  await Promise.all(
    users
      .filter((user): user is NonNullable<typeof user> => user !== null)
      .map((user) =>
        ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
          authUserId: user.authUserId,
          createdAt: user.createdAt,
          updatedAt: Date.now(),
        }),
      ),
  );
}

export const listOrganizationsForDirectory = query({
  args: {},
  handler: async (ctx) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);

    if (user.isSiteAdmin) {
      const organizations = await fetchAllBetterAuthOrganizations(ctx);

      return organizations
        .map((organization) => ({
          id: organization._id ?? organization.id ?? '',
          slug: organization.slug,
          name: organization.name,
          logo: organization.logo ?? null,
          viewerRole: 'site-admin' as const,
          canManage: true,
          isSiteAdminView: true,
        }))
        .filter((organization) => organization.id.length > 0)
        .sort((left, right) => left.name.localeCompare(right.name));
    }

    const memberships = await listOrganizationMembersForUser(ctx, user.authUserId);
    const organizations = await fetchBetterAuthOrganizationsByIds(
      ctx,
      memberships.map((membership) => membership.organizationId),
    );
    const organizationById = new Map(
      organizations.map((organization) => [
        organization._id ?? organization.id ?? '',
        organization,
      ]),
    );

    return memberships
      .map((membership) => {
        const organization = organizationById.get(membership.organizationId);
        if (!organization) {
          return null;
        }

        return {
          id: organization._id ?? membership.organizationId,
          slug: organization.slug,
          name: organization.name,
          logo: organization.logo ?? null,
          viewerRole: normalizeOrganizationRole(membership.role),
          canManage: membership.role === 'owner' || membership.role === 'admin',
          isSiteAdminView: false,
        };
      })
      .filter(
        (organization): organization is NonNullable<typeof organization> => organization !== null,
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const getOrganizationSettings = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view) {
      return null;
    }

    return {
      organization: {
        id: context.organization._id ?? context.organization.id ?? '',
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      access: context.access,
      isMember: context.viewerMembership !== null,
      viewerRole: context.viewerRole,
      canManage:
        context.access.siteAdmin ||
        context.viewerRole === 'owner' ||
        context.viewerRole === 'admin',
    };
  },
});

export const listOrganizationDirectory = query({
  args: {
    slug: v.string(),
    page: v.number(),
    pageSize: v.number(),
    sortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('kind'),
      v.literal('role'),
      v.literal('status'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    secondarySortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('kind'),
      v.literal('role'),
      v.literal('status'),
      v.literal('createdAt'),
    ),
    secondarySortOrder: v.union(v.literal('asc'), v.literal('desc')),
    search: v.string(),
    kind: v.union(v.literal('all'), v.literal('member'), v.literal('invite')),
  },
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view) {
      return null;
    }

    const organizationId = context.organization._id ?? context.organization.id;
    if (!organizationId) {
      throw new Error('Organization is missing an id');
    }

    const [memberships, invitations] = await Promise.all([
      listOrganizationMembers(ctx, organizationId),
      fetchBetterAuthInvitationsByOrganizationId(ctx, organizationId),
    ]);

    const ownerCount = memberships.filter((membership) => membership.role === 'owner').length;
    const authUsers = await fetchBetterAuthUsersByIds(
      ctx,
      memberships.map((membership) => membership.userId),
    );
    const authUsersById = new Map(
      authUsers.map((authUser) => [(authUser.id ?? authUser._id) as string, authUser]),
    );

    const memberRows: OrganizationMemberRow[] = memberships.map((membership) => {
      const authUser = authUsersById.get(membership.userId);
      const role = normalizeOrganizationRole(membership.role);
      const availableRoles = getAssignableRoles(context.viewerRole, role, ownerCount);

      return {
        id: `member:${membership._id ?? membership.userId}`,
        kind: 'member',
        membershipId: membership._id ?? '',
        authUserId: membership.userId,
        name: authUser?.name ?? null,
        email: authUser?.email ?? '',
        role,
        status: 'active',
        createdAt: toTimestamp(membership.createdAt),
        isSiteAdmin: authUser
          ? deriveIsSiteAdmin(normalizeUserRole(authUser.role))
          : false,
        availableRoles,
        canChangeRole: canChangeMemberRole(
          context.viewerRole,
          role,
          availableRoles,
          membership.userId === context.user.authUserId,
        ),
        canRemove: canRemoveMember(
          context.viewerRole,
          role,
          membership.userId === context.user.authUserId,
          ownerCount,
        ),
      };
    });

    const invitationRows: OrganizationInvitationRow[] = invitations
      .filter((invitation) => invitation.status === 'pending')
      .map(
        (invitation) =>
          ({
            id: `invite:${invitation._id ?? invitation.id ?? invitation.email}`,
            kind: 'invite',
            invitationId: invitation._id ?? invitation.id ?? '',
            name: null,
            email: invitation.email,
            role: invitation.role === 'admin' ? 'admin' : 'member',
            status: isInvitationExpired(invitation.expiresAt) ? 'expired' : 'pending',
            createdAt: toTimestamp(invitation.createdAt),
            expiresAt: toTimestamp(invitation.expiresAt),
            canRevoke:
              context.access.siteAdmin ||
              context.viewerRole === 'owner' ||
              context.viewerRole === 'admin',
          }) satisfies OrganizationInvitationRow,
      )
      .filter((invitation) => invitation.invitationId.length > 0);

    const searchValue = args.search.trim().toLowerCase();
    let rows: OrganizationDirectoryRow[] = [...memberRows, ...invitationRows];

    if (args.kind !== 'all') {
      rows = rows.filter((row) => row.kind === args.kind);
    }

    if (searchValue.length > 0) {
      rows = rows.filter((row) => {
        return (
          row.email.toLowerCase().includes(searchValue) ||
          (row.name?.toLowerCase().includes(searchValue) ?? false)
        );
      });
    }

    rows = [...rows].sort((left, right) => {
      const primary = compareValues(
        sortValue(left, args.sortBy),
        sortValue(right, args.sortBy),
        args.sortOrder,
      );
      if (primary !== 0) {
        return primary;
      }

      return compareValues(
        sortValue(left, args.secondarySortBy),
        sortValue(right, args.secondarySortBy),
        args.secondarySortOrder,
      );
    });

    const total = rows.length;
    const start = Math.max(0, (args.page - 1) * args.pageSize);
    const end = start + args.pageSize;

    return {
      organization: {
        id: organizationId,
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      access: context.access,
      viewerRole: context.viewerRole,
      rows: rows.slice(start, end),
      counts: {
        members: memberRows.length,
        invites: invitationRows.length,
      },
      pagination: {
        page: args.page,
        pageSize: args.pageSize,
        total,
        totalPages: Math.ceil(total / args.pageSize),
      },
    };
  },
});

export const createOrganizationInvitation = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const context = await requireOrganizationManagerById(ctx, args.organizationId);
    const email = normalizeEmail(args.email);
    if (!email) {
      throwConvexError('VALIDATION', 'Email is required');
    }

    const existingMember = await findBetterAuthUserByEmailAddress(ctx, email);
    if (existingMember) {
      const membership = await findBetterAuthMember(ctx, args.organizationId, existingMember.id);
      if (membership) {
        throwConvexError('VALIDATION', 'That user is already a member of this organization');
      }
    }

    const existingInvitations = await fetchBetterAuthInvitationsByOrganizationId(
      ctx,
      args.organizationId,
    );
    const pendingInvitations = existingInvitations.filter(
      (invitation) => invitation.status === 'pending' && normalizeEmail(invitation.email) === email,
    );

    await Promise.all(
      pendingInvitations.map((invitation) =>
        ctx.runMutation(components.betterAuth.adapter.updateMany, {
          input: {
            model: 'invitation',
            update: {
              status: 'canceled',
            },
            where: [{ field: '_id', operator: 'eq', value: invitation._id }],
          },
          paginationOpts: {
            cursor: null,
            numItems: 1,
            id: 0,
          },
        }),
      ),
    );

    const now = Date.now();
    const invitation = await createBetterAuthInvitation(ctx, {
      organizationId: args.organizationId,
      email,
      role: args.role,
      status: 'pending',
      inviterId: context.user.authUserId,
      expiresAt: now + INVITE_EXPIRY_MS,
      createdAt: now,
    });

    const invitationId = invitation._id ?? invitation.id;
    if (!invitationId) {
      throw new Error('Failed to create organization invitation');
    }

    await ctx.scheduler.runAfter(0, internal.emails.sendOrganizationInviteEmailMutation, {
      email,
      inviteUrl: `${getSiteUrl()}/invite/${invitationId}`,
      inviterName: context.user.authUser.name ?? context.user.authUser.email ?? 'An admin',
      organizationName: context.organization.name,
      role: args.role,
    });

    return { success: true, invitationId };
  },
});

export const updateOrganizationMemberRole = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const context = await requireOrganizationManagerById(ctx, args.organizationId);
    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      throwConvexError('NOT_FOUND', 'Organization member not found');
    }

    const currentRole = normalizeOrganizationRole(membership.role);
    const ownerCount = memberships.filter((candidate) => candidate.role === 'owner').length;
    const availableRoles = getAssignableRoles(context.viewerRole, currentRole, ownerCount);

    if (
      !canChangeMemberRole(
        context.viewerRole,
        currentRole,
        availableRoles,
        membership.userId === context.user.authUserId,
      )
    ) {
      throwConvexError('FORBIDDEN', 'Not authorized to change this member role');
    }

    if (!availableRoles.includes(args.role)) {
      throwConvexError('VALIDATION', 'That role change is not allowed');
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
        update: {
          role: args.role,
        },
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

export const removeOrganizationMember = mutation({
  args: {
    organizationId: v.string(),
    membershipId: v.string(),
  },
  handler: async (ctx, args) => {
    const context = await requireOrganizationManagerById(ctx, args.organizationId);
    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      throwConvexError('NOT_FOUND', 'Organization member not found');
    }

    const role = normalizeOrganizationRole(membership.role);
    const ownerCount = memberships.filter((candidate) => candidate.role === 'owner').length;

    if (
      !canRemoveMember(
        context.viewerRole,
        role,
        membership.userId === context.user.authUserId,
        ownerCount,
      )
    ) {
      throwConvexError('FORBIDDEN', 'Not authorized to remove this member');
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'member',
        where: [{ field: '_id', operator: 'eq', value: args.membershipId }],
      },
    });

    await repairUserContexts(ctx, [membership.userId]);

    return { success: true };
  },
});

export const cancelOrganizationInvitation = mutation({
  args: {
    organizationId: v.string(),
    invitationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrganizationManagerById(ctx, args.organizationId);

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'invitation',
        update: {
          status: 'canceled',
        },
        where: [
          { field: '_id', operator: 'eq', value: args.invitationId },
          {
            field: 'organizationId',
            operator: 'eq',
            value: args.organizationId,
            connector: 'AND',
          },
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

export const updateOrganizationSettings = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    logo: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireOrganizationManagerById(ctx, args.organizationId);
    const name = args.name.trim();
    if (!name) {
      throwConvexError('VALIDATION', 'Organization name is required');
    }

    const logo = args.logo?.trim() ?? null;

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'organization',
        update: {
          name,
          logo,
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

export const deleteOrganization = mutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrganizationManagerById(ctx, args.organizationId);

    const memberships = await listOrganizationMembers(ctx, args.organizationId);

    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'invitation',
        where: [{ field: 'organizationId', operator: 'eq', value: args.organizationId }],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1000,
        id: 0,
      },
    });

    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'member',
        where: [{ field: 'organizationId', operator: 'eq', value: args.organizationId }],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1000,
        id: 0,
      },
    });

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'organization',
        where: [{ field: '_id', operator: 'eq', value: args.organizationId }],
      },
    });

    await repairUserContexts(
      ctx,
      memberships.map((membership) => membership.userId),
    );

    return { success: true };
  },
});

async function listOrganizationMembersForUser(ctx: QueryCtx, authUserId: string) {
  return await fetchBetterAuthMembersByUserId(ctx, authUserId);
}

async function findBetterAuthUserByEmailAddress(ctx: MutationCtx, email: string) {
  const authUser = await findBetterAuthUserByEmail(ctx, email);
  if (!authUser) {
    return null;
  }

  const authUserId = authUser.id ?? authUser._id;
  if (!authUserId) {
    return null;
  }

  return {
    id: authUserId,
    email: authUser.email ?? email,
  };
}
