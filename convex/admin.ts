import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import type { ChatModelAccess, ChatModelCatalogEntry } from '../src/lib/shared/chat-models';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { assertUserId } from '../src/lib/shared/user-id';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from './_generated/server';
import { siteAdminAction, siteAdminMutation, siteAdminQuery } from './auth/authorized';
import { throwConvexError } from './auth/errors';
import {
  fetchAllBetterAuthUsers,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  findBetterAuthUserByEmail,
  normalizeBetterAuthUserProfile,
  updateBetterAuthUserRecord,
} from './lib/betterAuth';
import {
  adminUsersResponseValidator,
  aiModelCatalogEntryValidator,
  chatModelCatalogStatusValidator,
  createdChatModelResultValidator,
  importedModelCountValidator,
  mutationMessageResultValidator,
  promotedUserResultValidator,
  successValidator,
  systemStatsValidator,
  userProfileSyncStateDocValidator,
} from './lib/returnValidators';
import { recordSiteAdminAuditEvent } from './lib/auditEmitters';

const ADMIN_USER_INDEX_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CHAT_TASK = 'Text Generation';
const OPENROUTER_SOURCE = 'openrouter';
const ADMIN_USER_PAGE_BATCH_SIZE = 256;

type TruncateDataResult = {
  success: boolean;
  message: string;
  truncatedTables: number;
  failedTables: number;
  totalTables: number;
  failedTableNames: string[];
  invalidateAllCaches: boolean;
};

type CleanupDeletedUserDataResult = {
  success: boolean;
  deletedAuditLogs: number;
  deletedAppUser: number;
  email: string;
};

const chatModelCatalogInputValidator = v.object({
  modelId: v.string(),
  label: v.string(),
  description: v.string(),
  access: v.union(v.literal('public'), v.literal('admin')),
  supportsWebSearch: v.optional(v.boolean()),
  priceLabel: v.optional(v.string()),
  contextWindow: v.optional(v.number()),
  isActive: v.boolean(),
  beta: v.optional(v.boolean()),
  deprecated: v.optional(v.boolean()),
  deprecationDate: v.optional(v.string()),
});

const storedChatModelCatalogEntryValidator = v.object({
  modelId: v.string(),
  label: v.string(),
  description: v.string(),
  task: v.string(),
  access: v.union(v.literal('public'), v.literal('admin')),
  supportsWebSearch: v.optional(v.boolean()),
  priceLabel: v.optional(v.string()),
  prices: v.optional(
    v.array(
      v.object({
        unit: v.string(),
        price: v.number(),
        currency: v.string(),
      }),
    ),
  ),
  contextWindow: v.optional(v.number()),
  source: v.string(),
  isActive: v.boolean(),
  refreshedAt: v.number(),
  beta: v.optional(v.boolean()),
  deprecated: v.optional(v.boolean()),
  deprecationDate: v.optional(v.string()),
});

function toTimestamp(value: string | number | Date | undefined) {
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

function toStoredChatModelCatalogEntry(entry: ChatModelCatalogEntry) {
  return {
    modelId: entry.modelId,
    label: entry.label,
    description: entry.description,
    task: entry.task,
    access: entry.access,
    source: entry.source,
    isActive: entry.isActive,
    refreshedAt: entry.refreshedAt,
    ...(entry.supportsWebSearch !== undefined
      ? { supportsWebSearch: entry.supportsWebSearch }
      : {}),
    ...(entry.priceLabel ? { priceLabel: entry.priceLabel } : {}),
    ...(entry.prices ? { prices: entry.prices } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.beta !== undefined ? { beta: entry.beta } : {}),
    ...(entry.deprecated !== undefined ? { deprecated: entry.deprecated } : {}),
    ...(entry.deprecationDate ? { deprecationDate: entry.deprecationDate } : {}),
  };
}

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function buildChatModelCatalogEntry(
  input: {
    modelId: string;
    label: string;
    description: string;
    access: ChatModelAccess;
    supportsWebSearch?: boolean;
    priceLabel?: string;
    contextWindow?: number;
    isActive: boolean;
    beta?: boolean;
    deprecated?: boolean;
    deprecationDate?: string;
  },
  refreshedAt: number,
): ChatModelCatalogEntry {
  return {
    modelId: input.modelId.trim(),
    label: input.label.trim(),
    description: input.description.trim(),
    task: DEFAULT_CHAT_TASK,
    access: input.access,
    supportsWebSearch: input.supportsWebSearch ?? true,
    priceLabel: normalizeOptionalString(input.priceLabel),
    contextWindow: input.contextWindow,
    source: OPENROUTER_SOURCE,
    isActive: input.isActive,
    refreshedAt,
    beta: input.beta,
    deprecated: input.deprecated,
    deprecationDate: normalizeOptionalString(input.deprecationDate),
  };
}

type AdminUserSortField = 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
type UserProfileDoc = Doc<'userProfiles'>;
type UserRole = UserProfileDoc['role'];

function normalizeSearchValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

async function collectAdminUserSearchMatches(
  ctx: QueryCtx,
  searchValue: string,
  roleFilter: 'admin' | 'user' | null,
) {
  const searchQuery =
    roleFilter === null
      ? ctx.db
          .query('adminUserSearch')
          .withSearchIndex('search_text', (q) => q.search('searchText', searchValue))
      : ctx.db
          .query('adminUserSearch')
          .withSearchIndex('search_text', (q) =>
            q.search('searchText', searchValue).eq('role', roleFilter),
          );

  const profiles: UserProfileDoc[] = [];
  for await (const match of searchQuery) {
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', match.authUserId))
      .first();
    if (profile) {
      profiles.push(profile);
    }
  }

  return profiles;
}

async function countIndexedUserProfiles(ctx: QueryCtx, roleFilter: 'admin' | 'user' | null) {
  let count = 0;
  const query =
    roleFilter === null
      ? ctx.db.query('userProfiles').withIndex('by_created_at')
      : ctx.db.query('userProfiles').withIndex('by_role', (q) => q.eq('role', roleFilter));

  for await (const _profile of query) {
    count += 1;
  }

  return count;
}

function getRoleSortBuckets(direction: 'asc' | 'desc'): UserRole[] {
  return direction === 'asc' ? ['admin', 'user'] : ['user', 'admin'];
}

function getEmailVerifiedSortBuckets(direction: 'asc' | 'desc') {
  return direction === 'asc' ? [false, true] : [true, false];
}

async function fetchRoleBucketProfiles(
  ctx: QueryCtx,
  args: {
    role: UserRole;
    secondarySortBy: AdminUserSortField;
    secondarySortOrder: 'asc' | 'desc';
    takeCount: number;
  },
) {
  switch (args.secondarySortBy) {
    case 'name':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_role_and_name_lower', (q) => q.eq('role', args.role))
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'email':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_role_and_email_lower', (q) => q.eq('role', args.role))
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'emailVerified':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_role_and_email_verified', (q) => q.eq('role', args.role))
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'createdAt':
    case 'role':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_role_and_created_at', (q) => q.eq('role', args.role))
        .order(args.secondarySortOrder)
        .take(args.takeCount);
  }
}

async function fetchEmailVerifiedBucketProfiles(
  ctx: QueryCtx,
  args: {
    emailVerified: boolean;
    roleFilter: UserRole | null;
    secondarySortBy: AdminUserSortField;
    secondarySortOrder: 'asc' | 'desc';
    takeCount: number;
  },
) {
  if (args.roleFilter !== null) {
    const roleFilter = args.roleFilter;

    switch (args.secondarySortBy) {
      case 'name':
        return await ctx.db
          .query('userProfiles')
          .withIndex('by_role_and_email_verified_and_name_lower', (q) =>
            q.eq('role', roleFilter).eq('emailVerified', args.emailVerified),
          )
          .order(args.secondarySortOrder)
          .take(args.takeCount);
      case 'email':
        return await ctx.db
          .query('userProfiles')
          .withIndex('by_role_and_email_verified_and_email_lower', (q) =>
            q.eq('role', roleFilter).eq('emailVerified', args.emailVerified),
          )
          .order(args.secondarySortOrder)
          .take(args.takeCount);
      case 'createdAt':
        return await ctx.db
          .query('userProfiles')
          .withIndex('by_role_and_email_verified_and_created_at', (q) =>
            q.eq('role', roleFilter).eq('emailVerified', args.emailVerified),
          )
          .order(args.secondarySortOrder)
          .take(args.takeCount);
      case 'role':
      case 'emailVerified':
        return await ctx.db
          .query('userProfiles')
          .withIndex('by_role_and_email_verified', (q) =>
            q.eq('role', roleFilter).eq('emailVerified', args.emailVerified),
          )
          .order('asc')
          .take(args.takeCount);
    }
  }

  switch (args.secondarySortBy) {
    case 'name':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_email_verified_and_name_lower', (q) =>
          q.eq('emailVerified', args.emailVerified),
        )
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'email':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_email_verified_and_email_lower', (q) =>
          q.eq('emailVerified', args.emailVerified),
        )
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'role':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_email_verified_and_role', (q) => q.eq('emailVerified', args.emailVerified))
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'createdAt':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_email_verified_and_created_at', (q) =>
          q.eq('emailVerified', args.emailVerified),
        )
        .order(args.secondarySortOrder)
        .take(args.takeCount);
    case 'emailVerified':
      return await ctx.db
        .query('userProfiles')
        .withIndex('by_email_verified', (q) => q.eq('emailVerified', args.emailVerified))
        .order('asc')
        .take(args.takeCount);
  }
}

async function fetchBucketedPrimarySortProfiles(
  ctx: QueryCtx,
  args: {
    endIndex: number;
    roleFilter: UserRole | null;
    secondarySortBy: AdminUserSortField;
    secondarySortOrder: 'asc' | 'desc';
    sortBy: 'role' | 'emailVerified';
    sortOrder: 'asc' | 'desc';
  },
) {
  if (args.sortBy === 'role') {
    if (args.roleFilter !== null) {
      return await fetchRoleBucketProfiles(ctx, {
        role: args.roleFilter,
        secondarySortBy: args.secondarySortBy,
        secondarySortOrder: args.secondarySortOrder,
        takeCount: args.endIndex,
      });
    }

    const profiles: UserProfileDoc[] = [];
    for (const role of getRoleSortBuckets(args.sortOrder)) {
      const remaining = args.endIndex - profiles.length;
      if (remaining <= 0) {
        break;
      }
      profiles.push(
        ...(await fetchRoleBucketProfiles(ctx, {
          role,
          secondarySortBy: args.secondarySortBy,
          secondarySortOrder: args.secondarySortOrder,
          takeCount: remaining,
        })),
      );
    }
    return profiles;
  }

  const profiles: UserProfileDoc[] = [];
  for (const emailVerified of getEmailVerifiedSortBuckets(args.sortOrder)) {
    const remaining = args.endIndex - profiles.length;
    if (remaining <= 0) {
      break;
    }
    profiles.push(
      ...(await fetchEmailVerifiedBucketProfiles(ctx, {
        emailVerified,
        roleFilter: args.roleFilter,
        secondarySortBy: args.secondarySortBy,
        secondarySortOrder: args.secondarySortOrder,
        takeCount: remaining,
      })),
    );
  }
  return profiles;
}

function compareAdminUserValues(
  left: string | number,
  right: string | number,
  direction: 'asc' | 'desc',
) {
  if (left === right) {
    return 0;
  }

  if (direction === 'asc') {
    return left > right ? 1 : -1;
  }

  return left < right ? 1 : -1;
}

function sortAdminUsersPage(
  users: UserProfileDoc[],
  args: {
    sortBy: AdminUserSortField;
    sortOrder: 'asc' | 'desc';
    secondarySortBy: AdminUserSortField;
    secondarySortOrder: 'asc' | 'desc';
  },
) {
  const sortValue = (user: UserProfileDoc, field: AdminUserSortField): string | number => {
    switch (field) {
      case 'name':
        return user.nameLower ?? '';
      case 'email':
        return user.emailLower;
      case 'role':
        return user.role;
      case 'emailVerified':
        return user.emailVerified ? 1 : 0;
      default:
        return user.createdAt;
    }
  };

  return [...users].sort((left, right) => {
    const primary = compareAdminUserValues(
      sortValue(left, args.sortBy),
      sortValue(right, args.sortBy),
      args.sortOrder,
    );

    if (primary !== 0) {
      return primary;
    }

    return compareAdminUserValues(
      sortValue(left, args.secondarySortBy),
      sortValue(right, args.secondarySortBy),
      args.secondarySortOrder,
    );
  });
}

function toAdminUser(
  profile: UserProfileDoc,
  organizations: Array<{
    id: string;
    slug: string;
    name: string;
    logo: string | null;
  }>,
) {
  return {
    id: profile.authUserId,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    emailVerified: profile.emailVerified,
    banned: profile.banned,
    banReason: profile.banReason,
    banExpires: profile.banExpires,
    onboardingStatus: profile.onboardingStatus,
    ...(profile.onboardingEmailId ? { onboardingEmailId: profile.onboardingEmailId } : {}),
    ...(profile.onboardingEmailMessageId
      ? { onboardingEmailMessageId: profile.onboardingEmailMessageId }
      : {}),
    ...(profile.onboardingEmailLastSentAt !== undefined
      ? { onboardingEmailLastSentAt: profile.onboardingEmailLastSentAt }
      : {}),
    ...(profile.onboardingCompletedAt !== undefined
      ? { onboardingCompletedAt: profile.onboardingCompletedAt }
      : {}),
    ...(profile.onboardingDeliveryUpdatedAt !== undefined
      ? { onboardingDeliveryUpdatedAt: profile.onboardingDeliveryUpdatedAt }
      : {}),
    onboardingDeliveryError: profile.onboardingDeliveryError,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    organizations,
  };
}

export const listUsers = siteAdminQuery({
  args: {
    page: v.number(),
    pageSize: v.number(),
    sortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('role'),
      v.literal('emailVerified'),
      v.literal('createdAt'),
    ),
    sortOrder: v.union(v.literal('asc'), v.literal('desc')),
    secondarySortBy: v.union(
      v.literal('name'),
      v.literal('email'),
      v.literal('role'),
      v.literal('emailVerified'),
      v.literal('createdAt'),
    ),
    secondarySortOrder: v.union(v.literal('asc'), v.literal('desc')),
    search: v.string(),
    role: v.union(v.literal('all'), v.literal('admin'), v.literal('user')),
    cursor: v.optional(v.string()),
  },
  returns: adminUsersResponseValidator,
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.pageSize, ADMIN_USER_PAGE_BATCH_SIZE));
    const cursorPage = args.cursor ? Number.parseInt(args.cursor, 10) : Number.NaN;
    const page =
      Number.isFinite(cursorPage) && cursorPage > 0 ? cursorPage : Math.max(1, args.page);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const searchValue = normalizeSearchValue(args.search);
    const roleFilter = args.role === 'all' ? null : args.role;
    const searchMatchedProfiles = searchValue
      ? sortAdminUsersPage(await collectAdminUserSearchMatches(ctx, searchValue, roleFilter), args)
      : null;

    const indexedProfiles = async (): Promise<UserProfileDoc[] | null> => {
      if (args.sortBy === 'role' || args.sortBy === 'emailVerified') {
        return await fetchBucketedPrimarySortProfiles(ctx, {
          endIndex,
          roleFilter,
          secondarySortBy: args.secondarySortBy,
          secondarySortOrder: args.secondarySortOrder,
          sortBy: args.sortBy,
          sortOrder: args.sortOrder,
        });
      }

      if (args.sortBy === 'name') {
        return roleFilter
          ? await ctx.db
              .query('userProfiles')
              .withIndex('by_role_and_name_lower', (q) => q.eq('role', roleFilter))
              .order(args.sortOrder)
              .take(endIndex)
          : await ctx.db
              .query('userProfiles')
              .withIndex('by_name_lower')
              .order(args.sortOrder)
              .take(endIndex);
      }

      if (args.sortBy === 'email') {
        return roleFilter
          ? await ctx.db
              .query('userProfiles')
              .withIndex('by_role_and_email_lower', (q) => q.eq('role', roleFilter))
              .order(args.sortOrder)
              .take(endIndex)
          : await ctx.db
              .query('userProfiles')
              .withIndex('by_email_lower')
              .order(args.sortOrder)
              .take(endIndex);
      }

      if (args.sortBy === 'createdAt') {
        return roleFilter
          ? await ctx.db
              .query('userProfiles')
              .withIndex('by_role_and_created_at', (q) => q.eq('role', roleFilter))
              .order(args.sortOrder)
              .take(endIndex)
          : await ctx.db
              .query('userProfiles')
              .withIndex('by_created_at')
              .order(args.sortOrder)
              .take(endIndex);
      }

      return null;
    };

    const candidateProfiles = await indexedProfiles();
    if (candidateProfiles === null) {
      throw new Error(`Unsupported admin user sort field: ${args.sortBy}`);
    }
    const matchedProfiles = searchMatchedProfiles ?? candidateProfiles;

    const totalUsers =
      searchMatchedProfiles !== null
        ? searchMatchedProfiles.length
        : candidateProfiles !== null
          ? roleFilter !== null
            ? await countIndexedUserProfiles(ctx, roleFilter)
            : ((
                await ctx.db
                  .query('userProfileSyncState')
                  .withIndex('by_key', (q) => q.eq('key', 'global'))
                  .first()
              )?.totalUsers ?? (await countIndexedUserProfiles(ctx, null)))
          : matchedProfiles.length;

    const sortedPageUsers =
      searchMatchedProfiles !== null
        ? matchedProfiles.slice(startIndex, endIndex)
        : sortAdminUsersPage(matchedProfiles, args).slice(startIndex, endIndex);
    const pageUserIds = sortedPageUsers.map((user) => user.authUserId);

    const pageMemberships = await Promise.all(
      pageUserIds.map(async (authUserId) => {
        const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
        return [authUserId, memberships] as const;
      }),
    );

    const organizationIds = [
      ...new Set(
        pageMemberships.flatMap(([, memberships]) =>
          memberships.map((membership) => membership.organizationId),
        ),
      ),
    ];
    const organizations = await fetchBetterAuthOrganizationsByIds(ctx, organizationIds);
    const organizationsById = new Map(
      organizations.map((organization) => [
        organization._id ?? organization.id ?? '',
        organization,
      ]),
    );
    const membershipsByUserId = new Map(
      pageMemberships.map(([authUserId, memberships]) => [
        authUserId,
        memberships
          .map((membership) => {
            const organization = organizationsById.get(membership.organizationId);
            if (!organization) {
              return null;
            }

            return {
              id: organization._id ?? membership.organizationId,
              slug: organization.slug,
              name: organization.name,
              logo: organization.logo ?? null,
            };
          })
          .filter(
            (
              organization,
            ): organization is {
              id: string;
              slug: string;
              name: string;
              logo: string | null;
            } => organization !== null,
          )
          .sort((left, right) => left.name.localeCompare(right.name)),
      ]),
    );

    return {
      users: sortedPageUsers.map((user) =>
        toAdminUser(user, membershipsByUserId.get(user.authUserId) ?? []),
      ),
      pagination: {
        page,
        pageSize,
        total: totalUsers,
        totalPages: Math.ceil(totalUsers / pageSize),
        hasNextPage: endIndex < totalUsers,
        nextCursor: endIndex < totalUsers ? String(page + 1) : null,
      },
    };
  },
});

export const ensureUserIndex = siteAdminAction({
  args: {
    force: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.literal(true),
    synced: v.boolean(),
    totalUsers: v.number(),
  }),
  handler: async (ctx, args): Promise<{ success: true; synced: boolean; totalUsers: number }> => {
    const syncState = await ctx.runQuery(internal.admin.getUserIndexSyncStateInternal, {});
    const shouldSync =
      args.force === true ||
      !syncState ||
      Date.now() - syncState.lastFullSyncAt >= ADMIN_USER_INDEX_SYNC_INTERVAL_MS;

    if (!shouldSync) {
      return {
        success: true,
        synced: false,
        totalUsers: syncState.totalUsers,
      };
    }

    const users = await fetchAllBetterAuthUsers(ctx);
    const normalizedUsers = users.map(normalizeBetterAuthUserProfile);

    const result = await ctx.runAction(internal.users.syncUserProfilesSnapshot, {
      users: normalizedUsers,
    });

    return {
      success: true,
      synced: true,
      totalUsers: result.totalUsers,
    };
  },
});

export const recordAdminUserSessionsViewed = siteAdminAction({
  args: {
    sessionCount: v.number(),
    targetUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordSiteAdminAuditEvent(ctx, {
      actorUserId: ctx.user.authUserId,
      emitter: 'admin.user_sessions',
      eventType: 'admin_user_sessions_viewed',
      metadata: JSON.stringify({
        sessionCount: args.sessionCount,
        targetUserId: args.targetUserId,
      }),
      outcome: 'success',
      resourceId: args.targetUserId,
      resourceType: 'user_session',
      severity: 'info',
      sourceSurface: 'admin.user_sessions',
      userId: ctx.user.authUserId,
    });

    return null;
  },
});

export const getUserIndexSyncStateInternal = internalQuery({
  args: {},
  returns: v.union(userProfileSyncStateDocValidator, v.null()),
  handler: async (ctx) => {
    const syncStates = await ctx.db
      .query('userProfileSyncState')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .collect();

    return syncStates.reduce<(typeof syncStates)[number] | null>((current, candidate) => {
      if (!current) {
        return candidate;
      }

      if (candidate.lastFullSyncAt !== current.lastFullSyncAt) {
        return candidate.lastFullSyncAt > current.lastFullSyncAt ? candidate : current;
      }

      return candidate._creationTime > current._creationTime ? candidate : current;
    }, null);
  },
});

export const syncUserIndexEntry = siteAdminMutation({
  args: {
    userId: v.string(),
  },
  returns: successValidator,
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    return await ctx.runMutation(internal.users.syncAuthUserProfile, {
      authUserId: args.userId,
    });
  },
});

export const setUserOnboardingStatus = siteAdminMutation({
  args: {
    userId: v.string(),
    onboardingStatus: v.optional(
      v.union(
        v.literal('not_started'),
        v.literal('email_pending'),
        v.literal('email_sent'),
        v.literal('delivered'),
        v.literal('delivery_delayed'),
        v.literal('bounced'),
        v.literal('completed'),
      ),
    ),
    onboardingEmailId: v.optional(v.union(v.string(), v.null())),
    onboardingEmailMessageId: v.optional(v.union(v.string(), v.null())),
    onboardingEmailLastSentAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    onboardingDeliveryUpdatedAt: v.optional(v.number()),
    onboardingDeliveryError: v.optional(v.union(v.string(), v.null())),
  },
  returns: successValidator,
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    return await ctx.runMutation(internal.users.setAuthUserOnboardingState, {
      authUserId: args.userId,
      onboardingStatus: args.onboardingStatus as OnboardingStatus | undefined,
      onboardingEmailId: args.onboardingEmailId,
      onboardingEmailMessageId: args.onboardingEmailMessageId,
      onboardingEmailLastSentAt: args.onboardingEmailLastSentAt,
      onboardingCompletedAt: args.onboardingCompletedAt,
      onboardingDeliveryUpdatedAt: args.onboardingDeliveryUpdatedAt,
      onboardingDeliveryError: args.onboardingDeliveryError,
    });
  },
});

export const deleteUserIndexEntry = siteAdminMutation({
  args: {
    userId: v.string(),
  },
  returns: successValidator,
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    return await ctx.runMutation(internal.users.deleteAuthUserProfile, {
      authUserId: args.userId,
    });
  },
});

export const getSystemStats = siteAdminQuery({
  args: {},
  returns: systemStatsValidator,
  handler: async (ctx) => {
    const users = await fetchAllBetterAuthUsers(ctx);
    return {
      users: users.length,
      admins: users.filter((user) => deriveIsSiteAdmin(normalizeUserRole(user.role))).length,
    };
  },
});

export const promoteUserByEmail = internalAction({
  args: {
    email: v.string(),
  },
  returns: promotedUserResultValidator,
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const authUser = await findBetterAuthUserByEmail(ctx, email);
    if (!authUser) {
      throwConvexError('NOT_FOUND', 'User not found');
    }

    const authUserId = assertUserId(authUser, 'Better Auth user missing id');
    await updateBetterAuthUserRecord(ctx, authUserId, {
      role: 'admin',
    });

    await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
      authUserId,
      createdAt: toTimestamp(authUser.createdAt),
      updatedAt: Date.now(),
    });

    return {
      success: true,
      email,
      userId: authUserId,
    };
  },
});

export const getChatModelCatalogStatus = siteAdminQuery({
  args: {},
  returns: chatModelCatalogStatusValidator,
  handler: async (ctx) => {
    const activeModels = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_isActive', (q) => q.eq('isActive', true))
      .collect();

    const lastRefreshedAt =
      activeModels.length > 0
        ? activeModels.reduce((latest, model) => Math.max(latest, model.refreshedAt), 0)
        : null;

    return {
      activeModelsCount: activeModels.length,
      publicModelsCount: activeModels.filter((model) => model.access === 'public').length,
      adminModelsCount: activeModels.filter((model) => model.access === 'admin').length,
      lastRefreshedAt,
    };
  },
});

export const listChatModelCatalog = siteAdminQuery({
  args: {},
  returns: v.array(aiModelCatalogEntryValidator),
  handler: async (ctx): Promise<ChatModelCatalogEntry[]> => {
    const [activeModels, inactiveModels] = await Promise.all([
      ctx.db
        .query('aiModelCatalog')
        .withIndex('by_isActive', (q) => q.eq('isActive', true))
        .collect(),
      ctx.db
        .query('aiModelCatalog')
        .withIndex('by_isActive', (q) => q.eq('isActive', false))
        .collect(),
    ]);

    return [...activeModels, ...inactiveModels].sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }

      if (left.access !== right.access) {
        return left.access === 'public' ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });
  },
});

export const upsertImportedChatModels = internalMutation({
  args: {
    entries: v.array(storedChatModelCatalogEntryValidator),
    refreshedAt: v.number(),
  },
  returns: importedModelCountValidator,
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      const existingModel = await ctx.db
        .query('aiModelCatalog')
        .withIndex('by_modelId', (q) => q.eq('modelId', entry.modelId))
        .first();

      if (existingModel) {
        await ctx.db.patch(existingModel._id, {
          ...toStoredChatModelCatalogEntry(entry),
          refreshedAt: args.refreshedAt,
          isActive: true,
        });
        continue;
      }

      await ctx.db.insert('aiModelCatalog', {
        ...toStoredChatModelCatalogEntry(entry),
        refreshedAt: args.refreshedAt,
        isActive: true,
      });
    }

    return {
      modelCount: args.entries.length,
    };
  },
});

export const createChatModel = siteAdminMutation({
  args: {
    modelId: v.string(),
    label: v.string(),
    description: v.string(),
    access: v.union(v.literal('public'), v.literal('admin')),
    supportsWebSearch: v.optional(v.boolean()),
    priceLabel: v.optional(v.string()),
    contextWindow: v.optional(v.number()),
    isActive: v.boolean(),
    beta: v.optional(v.boolean()),
    deprecated: v.optional(v.boolean()),
    deprecationDate: v.optional(v.string()),
  },
  returns: createdChatModelResultValidator,
  handler: async (ctx, args) => {
    const modelId = args.modelId.trim();
    if (!modelId) {
      throwConvexError('VALIDATION', 'Model ID is required.');
    }

    const existingModel = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_modelId', (q) => q.eq('modelId', modelId))
      .first();

    if (existingModel) {
      throwConvexError('VALIDATION', 'A chat model with this model ID already exists.');
    }

    const entry = buildChatModelCatalogEntry(
      {
        ...args,
        modelId,
      },
      Date.now(),
    );

    const insertedId = await ctx.db.insert('aiModelCatalog', toStoredChatModelCatalogEntry(entry));

    return {
      success: true,
      message: `Added ${entry.label} to the OpenRouter model catalog.`,
      modelId: insertedId,
    };
  },
});

export const updateChatModel = siteAdminMutation({
  args: {
    existingModelId: v.string(),
    model: chatModelCatalogInputValidator,
  },
  returns: mutationMessageResultValidator,
  handler: async (ctx, args) => {
    const modelId = args.model.modelId.trim();
    if (!modelId) {
      throwConvexError('VALIDATION', 'Model ID is required.');
    }

    const existingModel = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_modelId', (q) => q.eq('modelId', args.existingModelId))
      .first();

    if (!existingModel) {
      throwConvexError('NOT_FOUND', 'Chat model not found.');
    }

    if (modelId !== args.existingModelId) {
      const duplicateModel = await ctx.db
        .query('aiModelCatalog')
        .withIndex('by_modelId', (q) => q.eq('modelId', modelId))
        .first();

      if (duplicateModel) {
        throwConvexError('VALIDATION', 'A chat model with this model ID already exists.');
      }
    }

    const entry = buildChatModelCatalogEntry(
      {
        ...args.model,
        modelId,
      },
      Date.now(),
    );

    await ctx.db.patch(existingModel._id, toStoredChatModelCatalogEntry(entry));

    return {
      success: true,
      message: `Updated ${entry.label}.`,
    };
  },
});

export const setChatModelActiveState = siteAdminMutation({
  args: {
    modelId: v.string(),
    isActive: v.boolean(),
  },
  returns: mutationMessageResultValidator,
  handler: async (ctx, args) => {
    const existingModel = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_modelId', (q) => q.eq('modelId', args.modelId))
      .first();

    if (!existingModel) {
      throwConvexError('NOT_FOUND', 'Chat model not found.');
    }

    await ctx.db.patch(existingModel._id, {
      isActive: args.isActive,
      refreshedAt: Date.now(),
    });

    return {
      success: true,
      message: `${existingModel.label} ${args.isActive ? 'activated' : 'deactivated'}.`,
    };
  },
});

export const truncateData = siteAdminAction({
  args: {},
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    truncatedTables: v.number(),
    failedTables: v.number(),
    totalTables: v.number(),
    failedTableNames: v.array(v.string()),
    invalidateAllCaches: v.boolean(),
  }),
  handler: async (_ctx): Promise<TruncateDataResult> => {
    return {
      success: true,
      message:
        'Audit logs are append-only in production. Truncation is disabled to preserve investigation evidence.',
      truncatedTables: 0,
      failedTables: 0,
      totalTables: 0,
      failedTableNames: [],
      invalidateAllCaches: false,
    };
  },
});

export const cleanupDeletedUserData = siteAdminAction({
  args: {
    userId: v.string(),
    email: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    deletedAuditLogs: v.number(),
    deletedAppUser: v.number(),
    email: v.string(),
  }),
  handler: async (ctx, args): Promise<CleanupDeletedUserDataResult> => {
    const userContextRecords = await ctx.runQuery(internal.users.getUserContextRecordIds, {
      authUserId: args.userId,
    });
    await ctx.runMutation(internal.users.deleteUserContextRecords, userContextRecords);
    const deletedAppUser = userContextRecords.appUserId || userContextRecords.userProfileId ? 1 : 0;

    return {
      success: true,
      deletedAuditLogs: 0,
      deletedAppUser,
      email: args.email,
    };
  },
});
