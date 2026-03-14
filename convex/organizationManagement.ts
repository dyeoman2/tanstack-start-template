import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  canChangeMemberRole,
  canDeleteOrganization,
  canManageOrganization,
  canRemoveMember,
  deriveViewerRole,
  getAssignableRoles,
  normalizeOrganizationRole,
  type OrganizationRole,
  type OrganizationViewerRole,
} from '../src/features/organizations/lib/organization-permissions';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalAction, internalMutation, internalQuery, query } from './_generated/server';
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
import {
  allowedResultValidator,
  chatThreadsDocValidator,
  directoryOrganizationValidator,
  organizationCreationEligibilityValidator,
  organizationDirectoryResponseValidator,
  organizationSettingsValidator,
} from './lib/returnValidators';
import { listStandaloneAttachmentsForOrganization } from './lib/organizationCleanup';

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
  role: OrganizationRole;
  status: 'pending' | 'expired';
  createdAt: number;
  expiresAt: number;
  canRevoke: boolean;
};

type OrganizationDirectoryRow = OrganizationMemberRow | OrganizationInvitationRow;
const ORGANIZATION_CLEANUP_BATCH_SIZE = 128;
const SELF_SERVE_ORGANIZATION_LIMIT = 2;

function getAvailableInviteRoles(viewerRole: OrganizationViewerRole): OrganizationRole[] {
  if (viewerRole === 'site-admin' || viewerRole === 'owner') {
    return ['owner', 'admin', 'member'];
  }

  if (viewerRole === 'admin') {
    return ['admin', 'member'];
  }

  return [];
}

function canLeaveOrganization(input: {
  ownerCount: number;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
}) {
  if (!input.viewerMembership) {
    return false;
  }

  return input.viewerMembership.role !== 'owner' || input.ownerCount > 1;
}

function buildOrganizationCapabilities(input: {
  ownerCount: number;
  viewerMembership: Awaited<ReturnType<typeof findBetterAuthMember>>;
  viewerRole: OrganizationViewerRole;
}) {
  return {
    availableInviteRoles: getAvailableInviteRoles(input.viewerRole),
    canInvite: getAvailableInviteRoles(input.viewerRole).length > 0,
    canUpdateSettings: canManageOrganization(input.viewerRole),
    canDeleteOrganization: canDeleteOrganization(input.viewerRole),
    canLeaveOrganization: canLeaveOrganization(input),
    canManageMembers: canManageOrganization(input.viewerRole),
  };
}

function toTimestamp(value: string | number | Date | undefined | null): number {
  if (!value) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function isInvitationExpired(expiresAt: string | number | Date | undefined | null, asOf: number) {
  return toTimestamp(expiresAt) <= asOf;
}

function matchesOrganizationDirectorySearch(row: OrganizationDirectoryRow, searchValue: string) {
  return (
    row.email.toLowerCase().includes(searchValue) ||
    (row.name?.toLowerCase().includes(searchValue) ?? false)
  );
}

function sortOrganizationDirectoryRows(
  rows: OrganizationDirectoryRow[],
  args: {
    sortBy: OrganizationDirectorySortField;
    sortOrder: OrganizationDirectorySortDirection;
    secondarySortBy: OrganizationDirectorySortField;
    secondarySortOrder: OrganizationDirectorySortDirection;
  },
) {
  return [...rows].sort((left, right) => {
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
  returns: v.array(directoryOrganizationValidator),
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

export const getOrganizationCreationEligibility = query({
  args: {},
  returns: organizationCreationEligibilityValidator,
  handler: async (ctx) => {
    const user = await getVerifiedCurrentUserOrThrow(ctx);

    if (user.isSiteAdmin) {
      const memberships = await listOrganizationMembersForUser(ctx, user.authUserId);
      return {
        count: memberships.length,
        limit: null,
        canCreate: true,
        reason: null,
        isUnlimited: true,
      };
    }

    const memberships = await listOrganizationMembersForUser(ctx, user.authUserId);
    const count = memberships.length;
    const canCreate = count < SELF_SERVE_ORGANIZATION_LIMIT;

    return {
      count,
      limit: SELF_SERVE_ORGANIZATION_LIMIT,
      canCreate,
      reason: canCreate
        ? null
        : `You can belong to up to ${SELF_SERVE_ORGANIZATION_LIMIT} organizations.`,
      isUnlimited: false,
    };
  },
});

export const getOrganizationSettings = query({
  args: {
    slug: v.string(),
  },
  returns: v.union(organizationSettingsValidator, v.null()),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view) {
      return null;
    }

    const organizationId = context.organization._id ?? context.organization.id;
    const ownerCount =
      organizationId && context.viewerMembership
        ? (await listOrganizationMembers(ctx, organizationId)).filter(
            (membership) => membership.role === 'owner',
          ).length
        : 0;
    const capabilities = buildOrganizationCapabilities({
      ownerCount,
      viewerMembership: context.viewerMembership,
      viewerRole: context.viewerRole,
    });

    return {
      organization: {
        id: context.organization._id ?? context.organization.id ?? '',
        slug: context.organization.slug,
        name: context.organization.name,
        logo: context.organization.logo ?? null,
      },
      access: context.access,
      capabilities,
      isMember: context.viewerMembership !== null,
      viewerRole: context.viewerRole,
      canManage: capabilities.canManageMembers || capabilities.canUpdateSettings,
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
  returns: allowedResultValidator,
  handler: async (ctx, args) => {
    const organization = await findBetterAuthOrganizationById(ctx, args.organizationId);
    if (!organization) {
      return {
        allowed: false as const,
        reason: 'Organization not found',
      };
    }

    const user = await getVerifiedCurrentUserOrThrow(ctx);
    const [_access, viewerMembership] = await Promise.all([
      checkOrganizationAccess(ctx, args.organizationId, { user }),
      findBetterAuthMember(ctx, args.organizationId, user.authUserId),
    ]);

    const viewerRole = deriveViewerRole({
      isSiteAdmin: user.isSiteAdmin,
      membershipRole: viewerMembership?.role,
    });

    if (args.action === 'invite') {
      const availableInviteRoles = getAvailableInviteRoles(viewerRole);
      if (availableInviteRoles.length === 0) {
        return {
          allowed: false as const,
          reason: 'Organization admin access required',
        };
      }

      if (args.nextRole && !availableInviteRoles.includes(args.nextRole)) {
        return {
          allowed: false as const,
          reason: 'You cannot assign that organization role',
        };
      }

      return { allowed: true as const };
    }

    if (args.action === 'cancel-invitation' || args.action === 'update-settings') {
      return canManageOrganization(viewerRole)
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: 'Organization admin access required',
          };
    }

    if (args.action === 'delete-organization') {
      return canDeleteOrganization(viewerRole)
        ? { allowed: true as const }
        : {
            allowed: false as const,
            reason: 'Organization owner access required',
          };
    }

    if (!args.membershipId) {
      return {
        allowed: false as const,
        reason: 'Organization member not found',
      };
    }

    const memberships = await listOrganizationMembers(ctx, args.organizationId);
    const membership = memberships.find((candidate) => (candidate._id ?? '') === args.membershipId);
    if (!membership) {
      return {
        allowed: false as const,
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
        ? { allowed: true as const }
        : {
            allowed: false as const,
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
      return { allowed: true as const };
    }

    return {
      allowed: false as const,
      reason: 'Not authorized to change this member role',
    };
  },
});

export const listOrganizationDirectory = query({
  args: {
    slug: v.string(),
    asOf: v.number(),
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
  returns: v.union(organizationDirectoryResponseValidator, v.null()),
  handler: async (ctx, args) => {
    const context = await getOrganizationAccessContextBySlug(ctx, args.slug);
    if (!context || !context.access.view || !canManageOrganization(context.viewerRole)) {
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
    const capabilities = buildOrganizationCapabilities({
      ownerCount,
      viewerMembership: context.viewerMembership,
      viewerRole: context.viewerRole,
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
            role: normalizeOrganizationRole(invitation.role),
            status: isInvitationExpired(invitation.expiresAt, args.asOf) ? 'expired' : 'pending',
            createdAt: toTimestamp(invitation.createdAt),
            expiresAt: toTimestamp(invitation.expiresAt),
            canRevoke: capabilities.canInvite,
          }) satisfies OrganizationInvitationRow,
      )
      .filter((invitation) => invitation.invitationId.length > 0);

    const searchValue = args.search.trim().toLowerCase();
    const inviteCount = invitationRows.length;
    const shouldIncludeInvites = args.kind === 'all' || args.kind === 'invite';
    const shouldIncludeMembers = args.kind === 'all' || args.kind === 'member';
    const needsAllMembersHydrated =
      shouldIncludeMembers &&
      (args.kind === 'all' ||
        searchValue.length > 0 ||
        args.sortBy === 'name' ||
        args.sortBy === 'email' ||
        args.secondarySortBy === 'name' ||
        args.secondarySortBy === 'email');

    let memberRows: OrganizationMemberRow[] = [];
    let memberCount = memberships.length;

    if (needsAllMembersHydrated) {
      const authUsers = await fetchBetterAuthUsersByIds(
        ctx,
        memberships.map((membership) => membership.userId),
      );
      const authUsersById = new Map(
        authUsers.map((authUser) => [(authUser.id ?? authUser._id) as string, authUser]),
      );

      memberRows = memberships.map((membership) => {
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
          isSiteAdmin: authUser ? deriveIsSiteAdmin(normalizeUserRole(authUser.role)) : false,
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
    } else if (shouldIncludeMembers) {
      const lightweightMemberRows = sortOrganizationDirectoryRows(
        memberships.map((membership) => {
          const role = normalizeOrganizationRole(membership.role);
          const availableRoles = getAssignableRoles(context.viewerRole, role, ownerCount);

          return {
            id: `member:${membership._id ?? membership.userId}`,
            kind: 'member' as const,
            membershipId: membership._id ?? '',
            authUserId: membership.userId,
            name: null,
            email: '',
            role,
            status: 'active' as const,
            createdAt: toTimestamp(membership.createdAt),
            isSiteAdmin: false,
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
        }),
        args,
      );

      memberCount = lightweightMemberRows.length;

      const combinedRows = shouldIncludeInvites
        ? sortOrganizationDirectoryRows([...lightweightMemberRows, ...invitationRows], args)
        : lightweightMemberRows;
      const filteredRows =
        searchValue.length > 0
          ? combinedRows.filter((row) => matchesOrganizationDirectorySearch(row, searchValue))
          : combinedRows;
      const total = filteredRows.length;
      const start = Math.max(0, (args.page - 1) * args.pageSize);
      const end = start + args.pageSize;
      const pagedMemberIds = filteredRows
        .slice(start, end)
        .filter((row): row is OrganizationMemberRow => row.kind === 'member')
        .map((row) => row.authUserId);
      const authUsers = await fetchBetterAuthUsersByIds(ctx, pagedMemberIds);
      const authUsersById = new Map(
        authUsers.map((authUser) => [(authUser.id ?? authUser._id) as string, authUser]),
      );
      const hydratedRows = filteredRows.slice(start, end).map((row) => {
        if (row.kind !== 'member') {
          return row;
        }

        const authUser = authUsersById.get(row.authUserId);
        return {
          ...row,
          name: authUser?.name ?? null,
          email: authUser?.email ?? '',
          isSiteAdmin: authUser ? deriveIsSiteAdmin(normalizeUserRole(authUser.role)) : false,
        } satisfies OrganizationMemberRow;
      });

      return {
        organization: {
          id: organizationId,
          slug: context.organization.slug,
          name: context.organization.name,
          logo: context.organization.logo ?? null,
        },
        access: context.access,
        capabilities,
        viewerRole: context.viewerRole,
        rows: hydratedRows,
        counts: {
          members: memberCount,
          invites: inviteCount,
        },
        pagination: {
          page: args.page,
          pageSize: args.pageSize,
          total,
          totalPages: Math.ceil(total / args.pageSize),
        },
      };
    }

    let rows: OrganizationDirectoryRow[] = [
      ...(shouldIncludeMembers ? memberRows : []),
      ...(shouldIncludeInvites ? invitationRows : []),
    ];

    if (searchValue.length > 0) {
      rows = rows.filter((row) => matchesOrganizationDirectorySearch(row, searchValue));
    }

    rows = sortOrganizationDirectoryRows(rows, args);

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
      capabilities,
      viewerRole: context.viewerRole,
      rows: rows.slice(start, end),
      counts: {
        members: memberCount,
        invites: inviteCount,
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

export const listOrganizationThreadsBatch = internalQuery({
  args: {
    organizationId: v.string(),
    limit: v.number(),
  },
  returns: v.array(chatThreadsDocValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('chatThreads')
      .withIndex('by_organizationId_and_updatedAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')
      .take(args.limit);
  },
});

export const deleteOrganizationStandaloneAttachmentsBatch = internalMutation({
  args: {
    organizationId: v.string(),
    limit: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const standaloneAttachments = await listStandaloneAttachmentsForOrganization(ctx, args);
    await Promise.all(
      standaloneAttachments.map(async (attachment) => {
        if (attachment.rawStorageId) {
          await ctx.storage.delete(attachment.rawStorageId);
        }

        if (attachment.extractedTextStorageId) {
          await ctx.storage.delete(attachment.extractedTextStorageId);
        }

        await ctx.db.delete(attachment._id);
      }),
    );
    return standaloneAttachments.length;
  },
});

export const deleteOrganizationPersonasBatch = internalMutation({
  args: {
    organizationId: v.string(),
    limit: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const personas = await ctx.db
      .query('aiPersonas')
      .withIndex('by_organizationId_and_createdAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('asc')
      .take(args.limit);

    await Promise.all(personas.map((persona) => ctx.db.delete(persona._id)));
    return personas.length;
  },
});

export const cleanupOrganizationDataInternal = internalAction({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    deletedThreads: v.number(),
    deletedStandaloneAttachments: v.number(),
    deletedPersonas: v.number(),
  }),
  handler: async (ctx, args) => {
    let deletedThreads = 0;
    let deletedStandaloneAttachments = 0;
    let deletedPersonas = 0;

    while (true) {
      const threads = await ctx.runQuery(
        internal.organizationManagement.listOrganizationThreadsBatch,
        {
          organizationId: args.organizationId,
          limit: ORGANIZATION_CLEANUP_BATCH_SIZE,
        },
      );

      if (threads.length === 0) {
        break;
      }

      for (const thread of threads as Array<{ _id: Id<'chatThreads'> }>) {
        const result = await ctx.runMutation(internal.agentChat.deleteThreadForCleanupInternal, {
          threadId: thread._id,
        });

        if (result.deleted) {
          deletedThreads += 1;
        }
      }
    }

    while (true) {
      const deletedCount = await ctx.runMutation(
        internal.organizationManagement.deleteOrganizationStandaloneAttachmentsBatch,
        {
          organizationId: args.organizationId,
          limit: ORGANIZATION_CLEANUP_BATCH_SIZE,
        },
      );

      if (deletedCount === 0) {
        break;
      }

      deletedStandaloneAttachments += deletedCount;
    }

    while (true) {
      const deletedCount = await ctx.runMutation(
        internal.organizationManagement.deleteOrganizationPersonasBatch,
        {
          organizationId: args.organizationId,
          limit: ORGANIZATION_CLEANUP_BATCH_SIZE,
        },
      );

      if (deletedCount === 0) {
        break;
      }

      deletedPersonas += deletedCount;
    }

    return {
      success: true,
      deletedThreads,
      deletedStandaloneAttachments,
      deletedPersonas,
    };
  },
});
