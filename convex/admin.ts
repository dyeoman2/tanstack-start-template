import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { normalizeAuditIdentifier } from '../src/lib/shared/auth-audit';
import { assertUserId } from '../src/lib/shared/user-id';
import { shapeAdminUsers } from '../src/features/admin/lib/admin-user-shaping';
import type { ChatModelAccess, ChatModelCatalogEntry } from '../src/lib/shared/chat-models';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { internal } from './_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { throwConvexError } from './auth/errors';
import {
  fetchAllBetterAuthMembers,
  fetchAllBetterAuthOrganizations,
  fetchAllBetterAuthUsers,
  findBetterAuthUserByEmail,
  normalizeBetterAuthUserProfile,
  updateBetterAuthUserRecord,
} from './lib/betterAuth';

const ADMIN_USER_INDEX_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_CHAT_TASK = 'Text Generation';
const OPENROUTER_SOURCE = 'openrouter';

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

async function requireSiteAdmin(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  if (!deriveIsSiteAdmin(normalizeUserRole((authUser as { role?: string | string[] }).role))) {
    throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
  }

  return authUser;
}

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

export const listUsers = query({
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
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const [profiles, memberships, organizations] = await Promise.all([
      args.role === 'all'
        ? ctx.db.query('userProfiles').collect()
        : ctx.db
            .query('userProfiles')
            .withIndex('by_role', (q) => q.eq('role', args.role === 'admin' ? 'admin' : 'user'))
            .collect(),
      fetchAllBetterAuthMembers(ctx),
      fetchAllBetterAuthOrganizations(ctx),
    ]);

    const organizationsById = new Map(
      organizations.map((organization) => [
        organization._id ?? organization.id ?? '',
        organization,
      ]),
    );
    const membershipsByUserId = new Map<
      string,
      Array<{
        id: string;
        slug: string;
        name: string;
        logo: string | null;
      }>
    >();

    for (const membership of memberships) {
      const organization = organizationsById.get(membership.organizationId);
      if (!organization) {
        continue;
      }

      const organizationSummary = {
        id: organization._id ?? membership.organizationId,
        slug: organization.slug,
        name: organization.name,
        logo: organization.logo ?? null,
      };
      const userOrganizations = membershipsByUserId.get(membership.userId) ?? [];

      if (!userOrganizations.some((entry) => entry.id === organizationSummary.id)) {
        userOrganizations.push(organizationSummary);
        userOrganizations.sort((left, right) => left.name.localeCompare(right.name));
        membershipsByUserId.set(membership.userId, userOrganizations);
      }
    }

    return shapeAdminUsers(
      profiles.map((profile) => ({
        id: profile.authUserId,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        emailVerified: profile.emailVerified,
        banned: profile.banned,
        banReason: profile.banReason,
        banExpires: profile.banExpires,
        onboardingStatus: profile.onboardingStatus ?? 'not_started',
        onboardingEmailId: profile.onboardingEmailId,
        onboardingEmailMessageId: profile.onboardingEmailMessageId,
        onboardingEmailLastSentAt: profile.onboardingEmailLastSentAt,
        onboardingCompletedAt: profile.onboardingCompletedAt,
        onboardingDeliveryUpdatedAt: profile.onboardingDeliveryUpdatedAt,
        onboardingDeliveryError: profile.onboardingDeliveryError ?? null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        organizations: membershipsByUserId.get(profile.authUserId) ?? [],
      })),
      args,
    );
  },
});

export const ensureUserIndex = action({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ success: true; synced: boolean; totalUsers: number }> => {
    await requireSiteAdmin(ctx);

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
  handler: async (ctx) => {
    return await ctx.db
      .query('userProfileSyncState')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();
  },
});

export const syncUserIndexEntry = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireSiteAdmin(ctx);
    return await ctx.runMutation(internal.users.syncAuthUserProfile, {
      authUserId: args.userId,
    });
  },
});

export const setUserOnboardingStatus = mutation({
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
    onboardingEmailId: v.optional(v.string()),
    onboardingEmailMessageId: v.optional(v.string()),
    onboardingEmailLastSentAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    onboardingDeliveryUpdatedAt: v.optional(v.number()),
    onboardingDeliveryError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireSiteAdmin(ctx);
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

export const deleteUserIndexEntry = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireSiteAdmin(ctx);
    return await ctx.runMutation(internal.users.deleteAuthUserProfile, {
      authUserId: args.userId,
    });
  },
});

export const getSystemStats = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const users = await fetchAllBetterAuthUsers(ctx);
    return {
      users: users.length,
      admins: users.filter((user) => deriveIsSiteAdmin(normalizeUserRole(user.role))).length,
    };
  },
});

export const promoteUserByEmail = action({
  args: {
    token: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret || args.token !== secret) {
      throw new Error('Unauthorized admin promotion access');
    }

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

export const getChatModelCatalogStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);

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

export const listChatModelCatalog = query({
  args: {},
  handler: async (ctx): Promise<ChatModelCatalogEntry[]> => {
    await requireSiteAdmin(ctx);

    const models = await ctx.db.query('aiModelCatalog').collect();
    return [...models].sort((left, right) => {
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

export const createChatModel = mutation({
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
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const modelId = args.modelId.trim();
    if (!modelId) {
      throw new Error('Model ID is required.');
    }

    const existingModel = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_modelId', (q) => q.eq('modelId', modelId))
      .first();

    if (existingModel) {
      throw new Error('A chat model with this model ID already exists.');
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

export const updateChatModel = mutation({
  args: {
    existingModelId: v.string(),
    model: chatModelCatalogInputValidator,
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const modelId = args.model.modelId.trim();
    if (!modelId) {
      throw new Error('Model ID is required.');
    }

    const existingModel = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_modelId', (q) => q.eq('modelId', args.existingModelId))
      .first();

    if (!existingModel) {
      throw new Error('Chat model not found.');
    }

    if (modelId !== args.existingModelId) {
      const duplicateModel = await ctx.db
        .query('aiModelCatalog')
        .withIndex('by_modelId', (q) => q.eq('modelId', modelId))
        .first();

      if (duplicateModel) {
        throw new Error('A chat model with this model ID already exists.');
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

export const setChatModelActiveState = mutation({
  args: {
    modelId: v.string(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const existingModel = await ctx.db
      .query('aiModelCatalog')
      .withIndex('by_modelId', (q) => q.eq('modelId', args.modelId))
      .first();

    if (!existingModel) {
      throw new Error('Chat model not found.');
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

export const truncateData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);

    const auditLogs = await ctx.db.query('auditLogs').collect();
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

export const cleanupDeletedUserData = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);

    const appUser = await ctx.db
      .query('users')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.userId))
      .first();

    if (appUser) {
      await ctx.db.delete(appUser._id);
    }

    const normalizedEmail = normalizeAuditIdentifier(args.email);
    const auditLogsByUserId = await ctx.db
      .query('auditLogs')
      .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', args.userId))
      .collect();
    const auditLogsByIdentifier = normalizedEmail
      ? await ctx.db
          .query('auditLogs')
          .withIndex('by_identifier_and_createdAt', (q) => q.eq('identifier', normalizedEmail))
          .collect()
      : [];
    const auditLogsById = new Map(
      [...auditLogsByUserId, ...auditLogsByIdentifier].map((log) => [log._id, log] as const),
    );

    for (const log of Array.from(auditLogsById.values())) {
      await ctx.db.delete(log._id);
    }

    return {
      success: true,
      deletedAuditLogs: auditLogsById.size,
      deletedAppUser: appUser ? 1 : 0,
      email: args.email,
    };
  },
});
