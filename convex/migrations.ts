import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation } from './_generated/server';
import {
  deriveIsSiteAdmin,
  normalizeUserRole,
} from '../src/features/auth/lib/user-role';

const USER_PROFILES_BACKFILL_BATCH_SIZE = 100;

export const backfillUserProfilesIsSiteAdminBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('userProfiles').paginate({
      cursor: args.cursor ?? null,
      numItems: USER_PROFILES_BACKFILL_BATCH_SIZE,
    });

    let updated = 0;

    for (const profile of result.page) {
      const nextIsSiteAdmin = deriveIsSiteAdmin(normalizeUserRole(profile.role));
      if (profile.isSiteAdmin === nextIsSiteAdmin) {
        continue;
      }

      await ctx.db.patch(profile._id, {
        isSiteAdmin: nextIsSiteAdmin,
      });
      updated += 1;
    }

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      updated,
    };
  },
});

export const runUserProfilesIsSiteAdminBackfill = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    let batches = 0;
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runMutation(
        internal.migrations.backfillUserProfilesIsSiteAdminBatch,
        {
          cursor,
        },
      );

      batches += 1;
      processed += result.processed;
      updated += result.updated;

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
    };
  },
});
