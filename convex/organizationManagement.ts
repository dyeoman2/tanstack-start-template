import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
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
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import {
  checkOrganizationAccess,
  getVerifiedCurrentUserOrThrow,
  listOrganizationMembers,
} from './auth/access';
import {
  fetchAllBetterAuthOrganizations,
  fetchBetterAuthInvitationsByOrganizationId,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  fetchBetterAuthUsersByIds,
  findBetterAuthMember,
  findBetterAuthOrganizationById,
  findBetterAuthOrganizationBySlug,
} from './lib/betterAuth';

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

export const getOrganizationWriteAccess = query({
  args: {
    organizationId: v.string(),
    action: v.union(
      v.literal('invite'),
      v.literal('update-member-role'),
      v.literal('remove-member'),
      v.literal('cancel-invitation'),
      v.literal('update-settings'),
      v.literal('delete-organization'),
    ),
    membershipId: v.optional(v.string()),
    nextRole: v.optional(v.union(v.literal('owner'), v.literal('admin'), v.literal('member'))),
  },
  handler: async (ctx, args) => {
    const organization = await findBetterAuthOrganizationById(ctx, args.organizationId);
    if (!organization) {
      return {
        allowed: false,
        reason: 'Organization not found',
      };
    }

    const user = await getVerifiedCurrentUserOrThrow(ctx);
    const [access, viewerMembership] = await Promise.all([
      checkOrganizationAccess(ctx, args.organizationId, { user }),
      findBetterAuthMember(ctx, args.organizationId, user.authUserId),
    ]);

    const viewerRole = deriveViewerRole({
      isSiteAdmin: user.isSiteAdmin,
      membershipRole: viewerMembership?.role,
    });

    if (
      args.action === 'invite' ||
      args.action === 'cancel-invitation' ||
      args.action === 'update-settings' ||
      args.action === 'delete-organization'
    ) {
      return canManageOrganization(viewerRole)
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'Organization admin access required',
          };
    }

    if (!args.membershipId) {
      return {
        allowed: false,
        reason: 'Organization member not found',
      };
    }

    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      return {
        allowed: false,
        reason: 'Organization member not found',
      };
    }

    const currentRole = normalizeOrganizationRole(membership.role);
    const ownerCount = memberships.filter((candidate) => candidate.role === 'owner').length;

    if (args.action === 'remove-member') {
      return canRemoveMember(
        viewerRole,
        currentRole,
        membership.userId === user.authUserId,
        ownerCount,
      )
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'Not authorized to remove this member',
          };
    }

    const availableRoles = getAssignableRoles(viewerRole, currentRole, ownerCount);

    if (
      canChangeMemberRole(
        viewerRole,
        currentRole,
        availableRoles,
        membership.userId === user.authUserId,
      ) &&
      args.nextRole &&
      availableRoles.includes(args.nextRole)
    ) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'Not authorized to change this member role',
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

async function listOrganizationMembersForUser(ctx: QueryCtx, authUserId: string) {
  return await fetchBetterAuthMembersByUserId(ctx, authUserId);
}
