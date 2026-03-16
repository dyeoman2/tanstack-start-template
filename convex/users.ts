import { ConvexError, v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { getEmailVerificationEnforcedAt } from '../src/lib/server/env.server';
import { getRecentStepUpWindowMs } from '../src/lib/server/security-config.server';
import { evaluateAuthPolicy } from '../src/lib/shared/auth-policy';
import { isEmailVerificationRequiredForUser } from '../src/lib/shared/email-verification';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
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
  getCurrentAuthUserOrThrow,
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
  fetchBetterAuthSessionsByUserId,
  normalizeBetterAuthUserProfile,
  updateBetterAuthSessionRecord,
} from './lib/betterAuth';
import { buildPersistedOnboardingState as buildPersistedOnboardingStateBase } from './lib/onboardingState';
import {
  bootstrapUserContextResultValidator,
  currentAppUserValidator,
  currentUserProfileValidator,
  ensureUserContextResultValidator,
  successTrueValidator,
  successValidator,
  userContextRecordsValidator,
  userCountValidator,
  userProfilesDocValidator,
  userRoleValidator,
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
      assignedRole: 'admin' | 'user';
      found: true;
    } & EnsureUserContextResult);

type UserProfileDocument = Doc<'userProfiles'>;

type OnboardingStatePatch = {
  onboardingStatus?: OnboardingStatus;
  onboardingEmailId?: string | null | undefined;
  onboardingEmailMessageId?: string | null | undefined;
  onboardingEmailLastSentAt?: number | undefined;
  onboardingCompletedAt?: number | undefined;
  onboardingDeliveryUpdatedAt?: number | undefined;
  onboardingDeliveryError?: string | null | undefined;
};
const USER_PROFILES_SYNC_BATCH_SIZE = 256;
const USER_COUNT_LOOKUP_LIMIT = 2;
const USER_PROFILE_SYNC_STATE_KEY = 'global';

const userProfileSyncInputValidator = v.object({
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
});

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

async function countPasskeysForAuthUser(
  ctx: QueryCtx | MutationCtx,
  authUserId: string,
): Promise<number> {
  const rawResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'passkey',
    where: [
      {
        field: 'userId',
        operator: 'eq',
        value: authUserId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: 1,
      id: 0,
    },
  });

  if (
    !rawResult ||
    typeof rawResult !== 'object' ||
    !('page' in rawResult) ||
    !Array.isArray(rawResult.page)
  ) {
    return 0;
  }

  return rawResult.page.length;
}

function buildPersistedOnboardingState(
  existing: UserProfileDocument | null,
  patch?: OnboardingStatePatch,
) {
  return buildPersistedOnboardingStateBase({
    existing,
    patch,
    defaultStatus: 'not_started',
  });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function resolveActiveOrganizationForUser(ctx: MutationCtx, authUserId: string) {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  if (memberships.length === 0) {
    return null;
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

  return null;
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
  ctx: ActionCtx,
  authUserId: string,
  now: number,
): Promise<BetterAuthOrganization> {
  const organization = await createBetterAuthOrganization(ctx, {
    createdAt: now,
    name: 'New Organization',
    slug: `${slugify(`org-${authUserId.slice(0, 8)}`)}-${now.toString(36)}`,
  });

  await createBetterAuthMember(ctx, {
    createdAt: now,
    organizationId: organization._id ?? organization.id,
    role: 'owner',
    userId: authUserId,
  });

  return organization;
}

async function assignBootstrapUserRole(
  ctx: MutationCtx,
  authUserId: string,
): Promise<'admin' | 'user'> {
  const currentUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [
      {
        field: '_id',
        operator: 'eq',
        value: authUserId,
      },
    ],
  })) as { role?: string | string[] | null } | null;

  const currentRole = normalizeUserRole(currentUser?.role ?? undefined);
  if (currentRole === 'admin') {
    return 'admin';
  }

  const existingAdmin = await ctx.db
    .query('userProfiles')
    .withIndex('by_role', (q) => q.eq('role', 'admin'))
    .first();

  const nextRole: 'admin' | 'user' = existingAdmin ? 'user' : 'admin';

  if (currentRole !== nextRole) {
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        update: {
          updatedAt: Date.now(),
          role: nextRole,
        },
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: authUserId,
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

  return nextRole;
}

async function listUserProfileSyncStateDocs(ctx: MutationCtx) {
  return await ctx.db
    .query('userProfileSyncState')
    .withIndex('by_key', (q) => q.eq('key', USER_PROFILE_SYNC_STATE_KEY))
    .collect();
}

function selectCanonicalUserProfileSyncState(syncStates: Array<Doc<'userProfileSyncState'>>) {
  return syncStates.reduce<Doc<'userProfileSyncState'> | null>((current, candidate) => {
    if (!current) {
      return candidate;
    }

    if (candidate.lastFullSyncAt !== current.lastFullSyncAt) {
      return candidate.lastFullSyncAt > current.lastFullSyncAt ? candidate : current;
    }

    return candidate._creationTime > current._creationTime ? candidate : current;
  }, null);
}

async function upsertUserProfileSyncState(
  ctx: MutationCtx,
  nextValue: {
    lastFullSyncAt: number;
    totalUsers: number;
  },
) {
  const syncStates = await listUserProfileSyncStateDocs(ctx);
  const canonicalSyncState = selectCanonicalUserProfileSyncState(syncStates);

  if (!canonicalSyncState) {
    const insertedId = await ctx.db.insert('userProfileSyncState', {
      key: USER_PROFILE_SYNC_STATE_KEY,
      ...nextValue,
    });
    const insertedDoc = await ctx.db.get(insertedId);

    if (!insertedDoc) {
      return;
    }

    const insertedStates = await listUserProfileSyncStateDocs(ctx);
    await Promise.all(
      insertedStates
        .filter((state) => state._id !== insertedDoc._id)
        .map((state) => ctx.db.delete(state._id)),
    );
    return;
  }

  await ctx.db.patch(canonicalSyncState._id, nextValue);
  await Promise.all(
    syncStates
      .filter((state) => state._id !== canonicalSyncState._id)
      .map((state) => ctx.db.delete(state._id)),
  );
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
  if (!resolvedOrganization) {
    throw new Error('User must belong to an organization before user context can be initialized');
  }

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
    const authUser = await getCurrentAuthUserOrNull(ctx);
    let rawResult: unknown;

    try {
      rawResult = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: USER_COUNT_LOOKUP_LIMIT,
          id: 0,
        },
      });
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
      throw new ConvexError({
        code: 'INTERNAL_ERROR',
        message: 'Unable to determine the current user count.',
      });
    }

    const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
    const observedUsers = normalized.page.length;

    return {
      totalUsers: observedUsers < USER_COUNT_LOOKUP_LIMIT ? observedUsers : null,
      isFirstUser: authUser ? observedUsers === 1 : observedUsers === 0,
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

export const assignBootstrapUserRoleMutation = internalMutation({
  args: {
    authUserId: v.string(),
  },
  returns: userRoleValidator,
  handler: async (ctx, args) => {
    return await assignBootstrapUserRole(ctx, args.authUserId);
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
    onboardingEmailId: v.optional(v.union(v.string(), v.null())),
    onboardingEmailMessageId: v.optional(v.union(v.string(), v.null())),
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

export const syncUserProfilesSnapshot = internalAction({
  args: {
    users: v.array(userProfileSyncInputValidator),
  },
  returns: v.object({
    success: v.literal(true),
    totalUsers: v.number(),
  }),
  handler: async (ctx, args) => {
    const syncTimestamp = Date.now();
    const activeAuthUserIds = new Set(args.users.map((user) => user.authUserId));

    for (let start = 0; start < args.users.length; start += USER_PROFILES_SYNC_BATCH_SIZE) {
      await ctx.runMutation(internal.users.syncUserProfilesSnapshotBatch, {
        syncTimestamp,
        users: args.users.slice(start, start + USER_PROFILES_SYNC_BATCH_SIZE),
      });
    }

    let cursor: string | null = null;

    while (true) {
      const page: {
        continueCursor: string;
        isDone: boolean;
        page: UserProfileDocument[];
      } = await ctx.runQuery(internal.users.listUserProfilesSyncPage, {
        cursor,
        numItems: USER_PROFILES_SYNC_BATCH_SIZE,
      });
      const staleProfileIds = page.page
        .filter((profile) => !activeAuthUserIds.has(profile.authUserId))
        .map((profile) => profile._id);

      if (staleProfileIds.length > 0) {
        await ctx.runMutation(internal.users.deleteUserProfilesBatch, {
          profileIds: staleProfileIds,
        });
      }

      if (page.isDone) {
        break;
      }

      cursor = page.continueCursor;
    }

    await ctx.runMutation(internal.users.finalizeUserProfilesSnapshotSync, {
      syncTimestamp,
      totalUsers: args.users.length,
    });

    return {
      success: true as const,
      totalUsers: args.users.length,
    };
  },
});

export const syncUserProfilesSnapshotBatch = internalMutation({
  args: {
    syncTimestamp: v.number(),
    users: v.array(userProfileSyncInputValidator),
  },
  returns: v.object({
    processed: v.number(),
  }),
  handler: async (ctx, args) => {
    for (const user of args.users) {
      const existing = await ctx.db
        .query('userProfiles')
        .withIndex('by_auth_user_id', (q) => q.eq('authUserId', user.authUserId))
        .first();
      const nextValue = {
        ...user,
        ...buildPersistedOnboardingState(existing ?? null, user),
        lastSyncedAt: args.syncTimestamp,
      };

      if (existing) {
        await ctx.db.replace(existing._id, nextValue);
        continue;
      }

      await ctx.db.insert('userProfiles', nextValue);
    }

    return { processed: args.users.length };
  },
});

export const listUserProfilesSyncPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    page: v.array(userProfilesDocValidator),
  }),
  handler: async (ctx, args) => {
    return await ctx.db.query('userProfiles').paginate({
      cursor: args.cursor,
      numItems: args.numItems,
    });
  },
});

export const deleteUserProfilesBatch = internalMutation({
  args: {
    profileIds: v.array(v.id('userProfiles')),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    for (const profileId of args.profileIds) {
      await ctx.db.delete(profileId);
    }

    return { deleted: args.profileIds.length };
  },
});

export const finalizeUserProfilesSnapshotSync = internalMutation({
  args: {
    syncTimestamp: v.number(),
    totalUsers: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertUserProfileSyncState(ctx, {
      lastFullSyncAt: args.syncTimestamp,
      totalUsers: args.totalUsers,
    });

    return null;
  },
});

export const bootstrapUserContext = internalAction({
  args: {
    authUserId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
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

    const assignedRole = await ctx.runMutation(internal.users.assignBootstrapUserRoleMutation, {
      authUserId: args.authUserId,
    });

    const existingMemberships = await fetchBetterAuthMembersByUserId(ctx, args.authUserId);
    if (existingMemberships.length === 0) {
      const organization = await createDefaultOrganization(ctx, args.authUserId, args.createdAt);
      const organizationId = organization._id ?? organization.id;
      if (!organizationId) {
        throw new Error('Failed to initialize default organization');
      }

      const sessions = await fetchBetterAuthSessionsByUserId(ctx, args.authUserId);
      await Promise.all(
        sessions.map(async (session) => {
          if (session.activeOrganizationId) {
            return;
          }

          await updateBetterAuthSessionRecord(ctx, session._id, {
            activeOrganizationId: organizationId,
          });
        }),
      );
    }

    const result = await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
      authUserId: args.authUserId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });

    return {
      assignedRole,
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
    const organizationIds = [
      ...new Set(memberships.map((membership) => membership.organizationId)),
    ];

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

export const ensureCurrentUserContext = action({
  args: {},
  returns: ensureUserContextResultValidator,
  handler: async (ctx): Promise<EnsureUserContextResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }
    const authUserId = assertUserId(authUser, 'User ID not found in auth user');
    const existingMemberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
    if (existingMemberships.length === 0) {
      await createDefaultOrganization(ctx, authUserId, Date.now());
    }

    return await ctx.runMutation(internal.users.ensureUserContextForAuthUser, {
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
    const authUser = await getCurrentAuthUserOrThrow(ctx);
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
      const passkeyCount = await countPasskeysForAuthUser(ctx, authUserId);
      const mfaEnabled = authUser.twoFactorEnabled === true || passkeyCount > 0;
      const authPolicy = evaluateAuthPolicy({
        assurance: {
          emailVerified,
          mfaEnabled,
          recentStepUpAt: null,
        },
        recentStepUpWindowMs: getRecentStepUpWindowMs(),
      });

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
        mfaEnabled,
        mfaRequired: true,
        requiresMfaSetup: authPolicy.requiresMfaSetup,
        recentStepUpAt: authPolicy.stepUp.verifiedAt,
        recentStepUpValidUntil: authPolicy.stepUp.validUntil,
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
