import { assertUserId } from '../../src/lib/shared/user-id';
import { internal } from '../_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { action, mutation, query } from '../_generated/server';
import { authComponent } from '../auth';
import type { Capability } from './policy.map';
import { Caps, PublicCaps } from './policy.map';

/**
 * Resolve the role for a given capability and context
 * Returns the user's role or throws if unauthorized
 */
async function resolveRole(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  cap: Capability,
): Promise<string> {
  // Check if this is a public capability
  if (PublicCaps.has(cap)) {
    return 'public';
  }

  // Get current user
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error(`Authentication required for capability: ${cap}`);
  }

  const userId = assertUserId(authUser, 'User ID not found');

  // Get user profile with role
  let profile: { role?: string } | null = null;
  if ('db' in ctx) {
    // Query or Mutation context - direct database access
    profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
  } else {
    // Action context - use runQuery since actions don't have direct db access
    profile = await ctx.runQuery(internal.users.getUserProfile, { userId });
  }

  const role = profile?.role || 'user';

  // Check if the role has the required capability
  const allowedRoles = Caps[cap] ?? [];
  if (!allowedRoles.some((allowedRole) => allowedRole === role)) {
    throw new Error(`Insufficient permissions for capability: ${cap}`);
  }

  return role;
}

// Export just the resolveRole function for manual capability checking
export { resolveRole };

/**
 * Guarded wrapper for Convex functions
 * Automatically enforces capability-based access control
 */
export const guarded = {
  /**
   * Create a guarded query that enforces capability-based access control
   */
  // biome-ignore lint/suspicious/noExplicitAny: Convex validator schemas require any for generic typing
  query: <Args extends Record<string, any>, Result>(
    cap: Capability,
    args: Args,
    // biome-ignore lint/suspicious/noExplicitAny: Convex runtime args are dynamically typed
    handler: (ctx: QueryCtx, args: any, role: string) => Promise<Result>,
  ) => {
    return query({
      args,
      // biome-ignore lint/suspicious/noExplicitAny: Convex runtime args are dynamically typed
      handler: async (ctx: QueryCtx, args: any) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },

  /**
   * Create a guarded mutation that enforces capability-based access control
   */
  // biome-ignore lint/suspicious/noExplicitAny: Convex validator schemas require any for generic typing
  mutation: <Args extends Record<string, any>, Result>(
    cap: Capability,
    args: Args,
    // biome-ignore lint/suspicious/noExplicitAny: Convex runtime args are dynamically typed
    handler: (ctx: MutationCtx, args: any, role: string) => Promise<Result>,
  ) => {
    return mutation({
      args,
      // biome-ignore lint/suspicious/noExplicitAny: Convex runtime args are dynamically typed
      handler: async (ctx: MutationCtx, args: any) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },

  /**
   * Create a guarded action that enforces capability-based access control
   */
  // biome-ignore lint/suspicious/noExplicitAny: Convex validator schemas require any for generic typing
  action: <Args extends Record<string, any>, Result>(
    cap: Capability,
    args: Args,
    // biome-ignore lint/suspicious/noExplicitAny: Convex runtime args are dynamically typed
    handler: (ctx: ActionCtx, args: any, role: string) => Promise<Result>,
  ) => {
    return action({
      args,
      // biome-ignore lint/suspicious/noExplicitAny: Convex runtime args are dynamically typed
      handler: async (ctx: ActionCtx, args: any) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },
};
