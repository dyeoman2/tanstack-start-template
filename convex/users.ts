import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { isEmailVerificationRequiredForUser } from '../src/lib/shared/email-verification';
import { getEmailVerificationEnforcedAt } from '../src/lib/server/env.server';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import {
  buildCurrentUserProfile,
  type CurrentUserProfile,
  getCurrentAuthUserOrNull,
  getCurrentUserOrNull,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import {
  type BetterAuthOrganization,
  type BetterAuthUser,
  createBetterAuthMember,
  createBetterAuthOrganization,
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  normalizeBetterAuthUserProfile,
} from './lib/betterAuth';
import {
  bootstrapUserContextResultValidator,
  currentAppUserValidator,
  currentUserProfileValidator,
  ensureUserContextResultValidator,
  successTrueValidator,
  successValidator,
  userContextRecordsValidator,
  userCountValidator,
} from './lib/returnValidators';

type EnsureUserContextArgs = {
  authUserId: string;
  createdAt: number;
  updatedAt: number;
};

type EnsureUserContextResult = {
  userId: Id<'users'>;
  organizationId: string;
};

type UserContextRecords = {
  appUserId: Id<'users'> | null;
  userProfileId: Id<'userProfiles'> | null;
};

type BootstrapUserContextResult =
  | {
      found: false;
    }
  | ({
      found: true;
    } & EnsureUserContextResult);

type UserProfileDocument = Doc<'userProfiles'>;

type OnboardingStatePatch = {
  onboardingStatus?: OnboardingStatus;
  onboardingEmailId?: string | undefined;
  onboardingEmailMessageId?: string | undefined;
  onboardingEmailLastSentAt?: number | undefined;
  onboardingCompletedAt?: number | undefined;
  onboardingDeliveryUpdatedAt?: number | undefined;
  onboardingDeliveryError?: string | null | undefined;
};
const USER_PROFILES_SYNC_BATCH_SIZE = 256;
const BETTER_AUTH_USER_COUNT_BATCH_SIZE = 1000;

function toTimestampOrFallback(
  value: string | number | Date | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? fallback : parsed;
}

function buildPersistedOnboardingState(
  existing: UserProfileDocument | null,
  patch?: OnboardingStatePatch,
) {
  return {
    onboardingStatus: patch?.onboardingStatus ?? existing?.onboardingStatus ?? 'not_started',
    onboardingEmailId: patch?.onboardingEmailId ?? existing?.onboardingEmailId,
    onboardingEmailMessageId: patch?.onboardingEmailMessageId ?? existing?.onboardingEmailMessageId,
    onboardingEmailLastSentAt:
      patch?.onboardingEmailLastSentAt ?? existing?.onboardingEmailLastSentAt,
    onboardingCompletedAt: patch?.onboardingCompletedAt ?? existing?.onboardingCompletedAt,
    onboardingDeliveryUpdatedAt:
      patch?.onboardingDeliveryUpdatedAt ?? existing?.onboardingDeliveryUpdatedAt,
    onboardingDeliveryError:
      patch?.onboardingDeliveryError ?? existing?.onboardingDeliveryError ?? null,
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function resolveActiveOrganizationForUser(
  ctx: MutationCtx,
  authUserId: string,
) {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  if (memberships.length === 0) {
    const organization = await createDefaultOrganization(ctx, authUserId, Date.now());
    const organizationId = organization._id ?? organization.id;
    if (!organizationId) {
      throw new Error('Failed to initialize default organization');
    }

    return {
      organization,
      organizationId,
    };
  }

  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const organizationsById = new Map(
    organizations.map((organization) => [organization._id ?? organization.id, organization]),
  );

  for (const membership of memberships) {
    const organization = organizationsById.get(membership.organizationId);
    if (organization) {
      return {
        organization,
        organizationId: organization._id ?? membership.organizationId,
      };
    }
  }

  const organization = await createDefaultOrganization(ctx, authUserId, Date.now());
  const organizationId = organization._id ?? organization.id;
  if (!organizationId) {
    throw new Error('Failed to initialize default organization');
  }

  return {
    organization,
    organizationId,
  };
}

async function patchAiOwnershipToOrganization(
  ctx: MutationCtx,
  authUserId: string,
  organizationId: string,
) {
  void ctx;
  void authUserId;
  void organizationId;
}

async function createDefaultOrganization(
  ctx: MutationCtx,
  authUserId: string,
  now: number,
): Promise<BetterAuthOrganization> {
  const slug = `${slugify(`org-${authUserId.slice(0, 8)}`)}-${now.toString(36)}`;
  const organization = await createBetterAuthOrganization(ctx, {
    name: 'New Organization',
    slug,
    createdAt: now,
  });

  await createBetterAuthMember(ctx, {
    organizationId: organization._id ?? organization.id,
    userId: authUserId,
    role: 'owner',
    createdAt: now,
  });

  return organization;
}

async function ensureUserContextRecord(
  ctx: MutationCtx,
  args: EnsureUserContextArgs,
): Promise<EnsureUserContextResult> {
  let user = await ctx.db
    .query('users')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.authUserId))
    .first();

  const resolvedOrganization = await resolveActiveOrganizationForUser(ctx, args.authUserId);
  const organizationId = resolvedOrganization.organizationId;

  if (!user) {
    const userId = await ctx.db.insert('users', {
      authUserId: args.authUserId,
      lastActiveOrganizationId: organizationId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
    user = await ctx.db.get(userId);
  }

  if (!user) {
    throw new Error('Failed to initialize user context');
  }

  await patchAiOwnershipToOrganization(ctx, args.authUserId, organizationId);
  await syncUserProfileByAuthUserId(ctx, args.authUserId);

  return {
    userId: user._id,
    organizationId,
  };
}

async function upsertUserProfileRecord(ctx: MutationCtx, authUser: BetterAuthUser) {
  const profile = normalizeBetterAuthUserProfile(authUser);
  const existing = await ctx.db
    .query('userProfiles')
    .withIndex('by_auth_user_id', (q) => q.eq('authUserId', profile.authUserId))
    .first();

  const nextValue = {
    ...profile,
    ...buildPersistedOnboardingState(existing),
    lastSyncedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.replace(existing._id, nextValue);
    return;
  }

  await ctx.db.insert('userProfiles', nextValue);
}

async function syncUserProfileByAuthUserId(ctx: MutationCtx, authUserId: string) {
  const authUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [
      {
        field: '_id',
        operator: 'eq',
        value: authUserId,
      },
    ],
  });

  if (!authUser) {
    return;
  }

  await upsertUserProfileRecord(ctx, authUser as BetterAuthUser);
}

export const getUserCount = query({
  args: {},
  returns: userCountValidator,
  handler: async (ctx) => {
    let totalUsers = 0;
    let cursor: string | null = null;

    try {
      while (true) {
        const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'user',
          paginationOpts: {
            cursor,
            numItems: BETTER_AUTH_USER_COUNT_BATCH_SIZE,
            id: 0,
          },
        });

        const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
        totalUsers += normalized.page.length;

        if (normalized.isDone || normalized.continueCursor === null) {
          break;
        }

        cursor = normalized.continueCursor;
      }
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
    }

    return {
      totalUsers,
      isFirstUser: totalUsers === 0,
    };
  },
});

export const ensureUserContextForAuthUser = internalMutation({
  args: {
    authUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  returns: ensureUserContextResultValidator,
  handler: async (ctx, args) => {
    return await ensureUserContextRecord(ctx, args);
  },
});

export const syncAuthUserProfile = internalMutation({
  args: {
    authUserId: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    await syncUserProfileByAuthUserId(ctx, args.authUserId);
    return { success: true };
  },
});

export const setAuthUserOnboardingState = internalMutation({
  args: {
    authUserId: v.string(),
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
  returns: successValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('userProfiles')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.authUserId))
      .first();

    if (!existing) {
      return { success: false };
    }

    await ctx.db.patch(existing._id, {
      ...buildPersistedOnboardingState(existing, args),
      lastSyncedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteAuthUserProfile = internalMutation({
  args: {
    authUserId: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('userProfiles')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.authUserId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});

export const syncUserProfilesSnapshot = internalMutation({
  args: {
    users: v.array(
      v.object({
        authUserId: v.string(),
        email: v.string(),
        emailLower: v.string(),
        name: v.union(v.string(), v.null()),
        nameLower: v.union(v.string(), v.null()),
        phoneNumber: v.union(v.string(), v.null()),
        role: v.union(v.literal('user'), v.literal('admin')),
        isSiteAdmin: v.boolean(),
        emailVerified: v.boolean(),
        banned: v.boolean(),
        banReason: v.union(v.string(), v.null()),
        banExpires: v.union(v.number(), v.null()),
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
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
    ),
  },
  returns: v.object({
    success: v.literal(true),
    totalUsers: v.number(),
  }),
  handler: async (ctx, args) => {
    const existingProfiles: UserProfileDocument[] = [];
    let cursor: string | null = null;

    while (true) {
      const result = await ctx.db.query('userProfiles').paginate({
        cursor,
        numItems: USER_PROFILES_SYNC_BATCH_SIZE,
      });
      existingProfiles.push(...result.page);

      if (result.isDone) {
        break;
      }

      cursor = result.continueCursor;
    }

    const existingByAuthUserId = new Map(
      existingProfiles.map((profile) => [profile.authUserId, profile]),
    );
    const activeAuthUserIds = new Set(args.users.map((user) => user.authUserId));
    const syncTimestamp = Date.now();

    for (const user of args.users) {
      const existing = existingByAuthUserId.get(user.authUserId);
      const nextValue = {
        ...user,
        ...buildPersistedOnboardingState(existing ?? null, user),
        lastSyncedAt: syncTimestamp,
      };

      if (existing) {
        await ctx.db.replace(existing._id, nextValue);
        existingByAuthUserId.delete(user.authUserId);
        continue;
      }

      await ctx.db.insert('userProfiles', nextValue);
    }

    for (const staleProfile of existingByAuthUserId.values()) {
      if (activeAuthUserIds.has(staleProfile.authUserId)) {
        continue;
      }

      await ctx.db.delete(staleProfile._id);
    }

    const syncState = await ctx.db
      .query('userProfileSyncState')
      .withIndex('by_key', (q) => q.eq('key', 'global'))
      .first();

    if (syncState) {
      await ctx.db.patch(syncState._id, {
        lastFullSyncAt: syncTimestamp,
        totalUsers: args.users.length,
      });
    } else {
      await ctx.db.insert('userProfileSyncState', {
        key: 'global',
        lastFullSyncAt: syncTimestamp,
        totalUsers: args.users.length,
      });
    }

    return {
      success: true as const,
      totalUsers: args.users.length,
    };
  },
});

export const bootstrapUserContext = internalAction({
  args: {
    authUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
  },
  returns: bootstrapUserContextResultValidator,
  handler: async (ctx, args): Promise<BootstrapUserContextResult> => {
    const authUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [
        {
          field: '_id',
          operator: 'eq',
          value: args.authUserId,
        },
      ],
    });

    if (!authUser) {
      return {
        found: false,
      };
    }

    if (args.role) {
      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'user',
          update: {
            updatedAt: Date.now(),
            role: args.role,
          },
          where: [
            {
              field: '_id',
              operator: 'eq',
              value: args.authUserId,
            },
          ],
        },
        paginationOpts: {
          cursor: null,
          numItems: 1,
          id: 0,
        },
      });
    }

    const result = await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
      authUserId: args.authUserId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });

    return {
      ...result,
      found: true,
    };
  },
});

export const rollbackBootstrapUserContext = internalAction({
  args: {
    authUserId: v.string(),
    email: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args): Promise<{ success: true }> => {
    const deletePaginationOpts = {
      cursor: null,
      numItems: 1000,
      id: 0,
    } as const;

    const memberships = await fetchBetterAuthMembersByUserId(ctx, args.authUserId);
    const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];

    for (const organizationId of organizationIds) {
      const rawMemberships = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
        paginationOpts: deletePaginationOpts,
      });
      const organizationMemberships = normalizeAdapterFindManyResult(rawMemberships).page;
      const remainingMemberships = organizationMemberships.filter(
        (membership) => membership.userId !== args.authUserId,
      );

      if (remainingMemberships.length === 0) {
        await Promise.all([
          ctx.runMutation(components.betterAuth.adapter.deleteMany, {
            input: {
              model: 'invitation',
              where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
            },
            paginationOpts: deletePaginationOpts,
          }),
          ctx.runMutation(components.betterAuth.adapter.deleteMany, {
            input: {
              model: 'member',
              where: [{ field: 'organizationId', operator: 'eq', value: organizationId }],
            },
            paginationOpts: deletePaginationOpts,
          }),
          ctx.runMutation(components.betterAuth.adapter.deleteOne, {
            input: {
              model: 'organization',
              where: [{ field: '_id', operator: 'eq', value: organizationId }],
            },
          }),
        ]);
      } else {
        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: {
            model: 'member',
            where: [
              { field: 'organizationId', operator: 'eq', value: organizationId },
              {
                field: 'userId',
                operator: 'eq',
                value: args.authUserId,
                connector: 'AND',
              },
            ],
          },
          paginationOpts: deletePaginationOpts,
        });
      }
    }

    await Promise.all([
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'session',
          where: [{ field: 'userId', operator: 'eq', value: args.authUserId }],
        },
        paginationOpts: deletePaginationOpts,
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'account',
          where: [{ field: 'userId', operator: 'eq', value: args.authUserId }],
        },
        paginationOpts: deletePaginationOpts,
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'verification',
          where: [{ field: 'identifier', operator: 'eq', value: args.email }],
        },
        paginationOpts: deletePaginationOpts,
      }),
      ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: {
          model: 'user',
          where: [{ field: '_id', operator: 'eq', value: args.authUserId }],
        },
        paginationOpts: deletePaginationOpts,
      }),
    ]);

    const userContextRecords = await ctx.runQuery(internal.users.getUserContextRecordIds, {
      authUserId: args.authUserId,
    });
    await ctx.runMutation(internal.users.deleteUserContextRecords, userContextRecords);

    return { success: true };
  },
});

export const getUserContextRecordIds = internalQuery({
  args: {
    authUserId: v.string(),
  },
  returns: userContextRecordsValidator,
  handler: async (ctx, args): Promise<UserContextRecords> => {
    const [appUser, userProfile] = await Promise.all([
      ctx.db
        .query('users')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.authUserId))
        .first(),
      ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', args.authUserId))
        .first(),
    ]);

    return {
      appUserId: appUser?._id ?? null,
      userProfileId: userProfile?._id ?? null,
    };
  },
});

export const deleteUserContextRecords = internalMutation({
  args: {
    appUserId: v.union(v.id('users'), v.null()),
    userProfileId: v.union(v.id('userProfiles'), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.appUserId) {
      await ctx.db.delete(args.appUserId);
    }

    if (args.userProfileId) {
      await ctx.db.delete(args.userProfileId);
    }

    return null;
  },
});

export const ensureCurrentUserContext = mutation({
  args: {},
  returns: ensureUserContextResultValidator,
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const authUserId = assertUserId(authUser, 'User ID not found in auth user');
    return await ensureUserContextRecord(ctx, {
      authUserId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateCurrentUserProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const userId = assertUserId(authUser, 'User ID not found in auth user');
    const updateData: {
      name?: string;
      phoneNumber?: string | null;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updateData.name = args.name.trim();
    }

    if (args.phoneNumber !== undefined) {
      updateData.phoneNumber = args.phoneNumber || null;
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        update: updateData,
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: userId,
          },
        ],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1,
        id: 0,
      },
    });

    await syncUserProfileByAuthUserId(ctx, userId);

    return { success: true };
  },
});

export const markCurrentUserOnboardingComplete = mutation({
  args: {},
  returns: v.union(
    v.object({
      success: v.literal(false),
    }),
    v.object({
      success: v.literal(true),
      onboardingCompletedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const authUser = await getCurrentAuthUserOrNull(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }
    const authUserId = assertUserId(authUser, 'User ID not found in auth user');

    const existing = await ctx.db
      .query('userProfiles')
      .withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
      .first();

    if (!existing) {
      return { success: false as const };
    }

    const onboardingCompletedAt = existing.onboardingCompletedAt ?? Date.now();
    await ctx.db.patch(existing._id, {
      onboardingStatus: 'completed',
      onboardingCompletedAt,
      onboardingDeliveryError: null,
      lastSyncedAt: Date.now(),
    });

    return {
      success: true as const,
      onboardingCompletedAt,
    };
  },
});

export const getCurrentUserProfile = query({
  args: {},
  returns: v.union(currentUserProfileValidator, v.null()),
  handler: async (ctx): Promise<CurrentUserProfile | null> => {
    const authUser = await getCurrentAuthUserOrNull(ctx);
    if (!authUser) {
      return null;
    }

    const user = await getCurrentUserOrNull(ctx);
    if (!user) {
      const authUserId = assertUserId(authUser, 'User ID not found in auth user');
      const role = normalizeUserRole(
        (authUser as BetterAuthAdapterUserDoc & { role?: string | string[] }).role,
      );
      const createdAt = toTimestampOrFallback(authUser.createdAt, 0);
      const emailVerified = authUser.emailVerified ?? false;

      return {
        id: authUserId,
        email: authUser.email ?? '',
        name: authUser.name ?? null,
        phoneNumber: authUser.phoneNumber ?? null,
        role,
        isSiteAdmin: deriveIsSiteAdmin(role),
        emailVerified,
        requiresEmailVerification: isEmailVerificationRequiredForUser({
          createdAt,
          emailVerified,
          enforcedAt: getEmailVerificationEnforcedAt(),
        }),
        createdAt,
        updatedAt: toTimestampOrFallback(authUser.updatedAt, 0),
        currentOrganization: null,
        organizations: [],
      };
    }

    return await buildCurrentUserProfile(ctx, user);
  },
});

export const getCurrentAppUser = query({
  args: {},
  returns: v.union(currentAppUserValidator, v.null()),
  handler: async (ctx) => {
    return await getCurrentUserOrNull(ctx);
  },
});
