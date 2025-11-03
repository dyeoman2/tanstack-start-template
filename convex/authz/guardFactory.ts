import { assertUserId } from '../../src/lib/shared/user-id';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { action, mutation, query } from '../_generated/server';
import { authComponent } from '../auth';
import type { Capability } from './policy.map';
import { Caps, PublicCaps } from './policy.map';

/**
 * Resolve the role for a given capability and context
 * Returns the user's role or throws if unauthorized
 */
async function resolveRole(ctx: QueryCtx | MutationCtx, cap: Capability): Promise<string> {
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
  const profile = await ctx.db
    .query('userProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();

  const role = profile?.role || 'user';

  // Check if the role has the required capability
  const allowedRoles = Caps[cap] ?? [];
  if (!allowedRoles.includes(role as any)) {
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
  query: <Args extends Record<string, any>, Result>(
    cap: Capability,
    args: Args,
    handler: (ctx: QueryCtx, args: any, role: string) => Promise<Result>,
  ) => {
    return query({
      args,
      handler: async (ctx: any, args: any) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },

  /**
   * Create a guarded mutation that enforces capability-based access control
   */
  mutation: <Args extends Record<string, any>, Result>(
    cap: Capability,
    args: Args,
    handler: (ctx: MutationCtx, args: any, role: string) => Promise<Result>,
  ) => {
    return mutation({
      args,
      handler: async (ctx: any, args: any) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },

  /**
   * Create a guarded action that enforces capability-based access control
   */
  action: <Args extends Record<string, any>, Result>(
    cap: Capability,
    args: Args,
    handler: (ctx: ActionCtx, args: any, role: string) => Promise<Result>,
  ) => {
    return action({
      args,
      handler: async (ctx: any, args: any) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },
};
