import type { GenericCtx } from '@convex-dev/better-auth';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../../src/lib/shared/user-id';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx } from '../_generated/server';

type CtxWithRunMutation = GenericCtx<DataModel> & {
  runMutation: MutationCtx['runMutation'] | ActionCtx['runMutation'];
};

export type BetterAuthUser = BetterAuthAdapterUserDoc & {
  role?: string | string[];
  banned?: boolean;
  banReason?: string | null;
  banExpires?: Date | string | number | null;
};

export async function fetchAllBetterAuthUsers(
  ctx: GenericCtx<DataModel>,
): Promise<BetterAuthUser[]> {
  const allUsers: BetterAuthUser[] = [];
  let cursor: string | null = null;

  while (true) {
    const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: {
        cursor,
        numItems: 1000,
        id: 0,
      },
    });

    const normalized = normalizeAdapterFindManyResult<BetterAuthUser>(rawResult);
    const { page, continueCursor, isDone } = normalized;
    allUsers.push(...page);

    if (isDone || !continueCursor || page.length < 1000) {
      break;
    }

    cursor = continueCursor;
  }

  return allUsers;
}

export async function fetchBetterAuthUsersByIds(
  ctx: GenericCtx<DataModel>,
  userIds: string[],
): Promise<BetterAuthUser[]> {
  if (userIds.length === 0) {
    return [];
  }

  const remainingIds = new Set(userIds);
  const matchedUsers: BetterAuthUser[] = [];
  const allUsers = await fetchAllBetterAuthUsers(ctx);

  for (const user of allUsers) {
    const userId = assertUserId(user, 'Better Auth user missing id');
    if (remainingIds.has(userId)) {
      matchedUsers.push(user);
      remainingIds.delete(userId);
    }

    if (remainingIds.size === 0) {
      break;
    }
  }

  return matchedUsers;
}

export async function findBetterAuthUserByEmail(
  ctx: GenericCtx<DataModel>,
  email: string,
): Promise<BetterAuthUser | null> {
  const rawUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [
      {
        field: 'email',
        operator: 'eq',
        value: email,
      },
    ],
  })) as BetterAuthUser | null;

  return rawUser;
}

export async function updateBetterAuthUserRecord(
  ctx: CtxWithRunMutation,
  userId: string,
  data: Record<string, unknown>,
) {
  await ctx.runMutation(components.betterAuth.adapter.updateMany, {
    input: {
      model: 'user',
      update: {
        ...data,
        updatedAt: Date.now(),
      },
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
}
