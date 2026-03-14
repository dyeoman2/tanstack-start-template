import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { normalizeAuditIdentifier } from '../src/lib/shared/auth-audit';
import type { ChatModelAccess, ChatModelCatalogEntry } from '../src/lib/shared/chat-models';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
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

const ADMIN_USER_INDEX_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CHAT_TASK = 'Text Generation';
const OPENROUTER_SOURCE = 'openrouter';
const AUDIT_LOG_TRUNCATION_BATCH_SIZE = 256;
const ADMIN_USER_PAGE_BATCH_SIZE = 256;
const USER_CLEANUP_BATCH_SIZE = 256;

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

function mapAdminUserSortField(sortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt') {
  switch (sortBy) {
    case 'createdAt':
      return 'createdAt';
    case 'email':
      return 'email';
    case 'emailVerified':
      return 'emailVerified';
    case 'role':
      return 'role';
    default:
      return 'name';
  }
}

function normalizeSearchValue(value: string) {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function matchesAdminUserSearch(
  user: ReturnType<typeof normalizeBetterAuthUserProfile>,
  searchValue: string | null,
) {
  if (!searchValue) {
    return true;
  }

  return user.emailLower.includes(searchValue) || (user.nameLower?.includes(searchValue) ?? false);
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
  users: Array<ReturnType<typeof normalizeBetterAuthUserProfile>>,
  args: {
    sortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
    sortOrder: 'asc' | 'desc';
    secondarySortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
    secondarySortOrder: 'asc' | 'desc';
  },
) {
  const sortValue = (
    user: ReturnType<typeof normalizeBetterAuthUserProfile>,
    field: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt',
  ): string | number => {
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
    const roleWhere =
      args.role === 'all'
        ? undefined
        : [
            {
              field: 'role',
              operator: 'eq' as const,
              value: args.role,
            },
          ];

    const matchedUsers: Array<ReturnType<typeof normalizeBetterAuthUserProfile>> = [];
    let cursor: string | null = null;

    while (true) {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        where: roleWhere,
        sortBy: {
          field: mapAdminUserSortField(args.sortBy),
          direction: args.sortOrder,
        },
        paginationOpts: {
          cursor,
          numItems: ADMIN_USER_PAGE_BATCH_SIZE,
          id: 0,
        },
      });

      const result = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);

      for (const authUser of result.page) {
        const normalizedUser = normalizeBetterAuthUserProfile(authUser);
        if (!matchesAdminUserSearch(normalizedUser, searchValue)) {
          continue;
        }

        matchedUsers.push(normalizedUser);
      }

      if (result.isDone || !result.continueCursor) {
        break;
      }

      cursor = result.continueCursor;
    }

    const totalUsers = matchedUsers.length;
    const sortedPageUsers = sortAdminUsersPage(matchedUsers, args).slice(startIndex, endIndex);
    const pageUserIds = sortedPageUsers.map((user) => user.authUserId);

    const [profileEntries, pageMemberships] = await Promise.all([
      Promise.all(
        pageUserIds.map(async (authUserId) => {
          const profile = await ctx.db
            .query('userProfiles')
            .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
            .first();
          return [authUserId, profile] as const;
        }),
      ),
      Promise.all(
        pageUserIds.map(async (authUserId) => {
          const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
          return [authUserId, memberships] as const;
        }),
      ),
    ]);

    const profilesByAuthUserId = new Map(profileEntries);
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
      users: sortedPageUsers.map((user) => {
        const profile = profilesByAuthUserId.get(user.authUserId);

        return {
          id: user.authUserId,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: user.emailVerified,
          banned: user.banned,
          banReason: user.banReason,
          banExpires: user.banExpires,
          onboardingStatus: profile?.onboardingStatus ?? 'not_started',
          onboardingEmailId: profile?.onboardingEmailId,
          onboardingEmailMessageId: profile?.onboardingEmailMessageId,
          onboardingEmailLastSentAt: profile?.onboardingEmailLastSentAt,
          onboardingCompletedAt: profile?.onboardingCompletedAt,
          onboardingDeliveryUpdatedAt: profile?.onboardingDeliveryUpdatedAt,
          onboardingDeliveryError: profile?.onboardingDeliveryError ?? null,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          organizations: membershipsByUserId.get(user.authUserId) ?? [],
        };
      }),
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

    const result = await ctx.runMutation(internal.users.syncUserProfilesSnapshot, {
      users: normalizedUsers,
    });

    return {
      success: true,
      synced: true,
      totalUsers: result.totalUsers,
    };
  },
});

export const getUserIndexSyncStateInternal = internalQuery({
  args: {},
  returns: v.union(userProfileSyncStateDocValidator, v.null()),
  handler: async (ctx) => {
    return await ctx.db
      .query('userProfileSyncState')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();
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

export const truncateAuditLogsBatch = internalMutation({
  args: {},
  returns: v.object({
    deletedCount: v.number(),
    failedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_createdAt')
      .order('asc')
      .take(AUDIT_LOG_TRUNCATION_BATCH_SIZE);

    let deletedCount = 0;
    let failedCount = 0;

    for (const log of auditLogs) {
      try {
        await ctx.db.delete(log._id);
        deletedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error(`Failed to delete audit log ${log._id}:`, error);
      }
    }

    return {
      deletedCount,
      failedCount,
      hasMore: auditLogs.length === AUDIT_LOG_TRUNCATION_BATCH_SIZE,
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
  handler: async (ctx): Promise<TruncateDataResult> => {
    let deletedCount = 0;
    let failedCount = 0;

    while (true) {
      const batch = await ctx.runMutation(internal.admin.truncateAuditLogsBatch, {});
      deletedCount += batch.deletedCount;
      failedCount += batch.failedCount;

      if (!batch.hasMore) {
        break;
      }
    }

    return {
      success: failedCount === 0,
      message:
        failedCount === 0
          ? 'All audit logs have been truncated successfully. User accounts and authentication data preserved.'
          : `Partial truncation completed. ${deletedCount} audit logs deleted, ${failedCount} failed. User accounts and authentication data preserved.`,
      truncatedTables: deletedCount > 0 ? 1 : 0,
      failedTables: failedCount > 0 ? 1 : 0,
      totalTables: 1,
      failedTableNames: failedCount > 0 ? ['auditLogs'] : [],
      invalidateAllCaches: true,
    };
  },
});

export const deleteAuditLogsByUserIdBatch = internalMutation({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', args.userId))
      .order('asc')
      .take(USER_CLEANUP_BATCH_SIZE);

    for (const log of auditLogs) {
      await ctx.db.delete(log._id);
    }

    return {
      deletedCount: auditLogs.length,
      hasMore: auditLogs.length === USER_CLEANUP_BATCH_SIZE,
    };
  },
});

export const deleteAuditLogsByIdentifierBatch = internalMutation({
  args: {
    identifier: v.string(),
  },
  returns: v.object({
    deletedCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const auditLogs = await ctx.db
      .query('auditLogs')
      .withIndex('by_identifier_and_createdAt', (q) => q.eq('identifier', args.identifier))
      .order('asc')
      .take(USER_CLEANUP_BATCH_SIZE);

    for (const log of auditLogs) {
      await ctx.db.delete(log._id);
    }

    return {
      deletedCount: auditLogs.length,
      hasMore: auditLogs.length === USER_CLEANUP_BATCH_SIZE,
    };
  },
});

export const deleteAppUserContextInternal = internalMutation({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    deletedAppUser: v.number(),
  }),
  handler: async (ctx, args) => {
    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.userId))
      .first();

    if (!appUser) {
      return { deletedAppUser: 0 };
    }

    await ctx.db.delete(appUser._id);
    return { deletedAppUser: 1 };
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
    const deleteAppUserResult: { deletedAppUser: number } = await ctx.runMutation(
      internal.admin.deleteAppUserContextInternal,
      {
        userId: args.userId,
      },
    );
    const deletedAppUser = deleteAppUserResult.deletedAppUser;

    let deletedAuditLogs = 0;

    while (true) {
      const batch = await ctx.runMutation(internal.admin.deleteAuditLogsByUserIdBatch, {
        userId: args.userId,
      });
      deletedAuditLogs += batch.deletedCount;

      if (!batch.hasMore) {
        break;
      }
    }

    const normalizedEmail = normalizeAuditIdentifier(args.email);
    if (normalizedEmail) {
      while (true) {
        const batch = await ctx.runMutation(internal.admin.deleteAuditLogsByIdentifierBatch, {
          identifier: normalizedEmail,
        });
        deletedAuditLogs += batch.deletedCount;

        if (!batch.hasMore) {
          break;
        }
      }
    }

    return {
      success: true,
      deletedAuditLogs,
      deletedAppUser,
      email: args.email,
    };
  },
});
