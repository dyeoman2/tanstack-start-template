import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, query } from './_generated/server';
import {
  evaluateStepUpClaim,
  getStepUpRequirementPolicy,
  isStepUpMethodAllowed,
  STEP_UP_REQUIREMENTS,
  STEP_UP_METHODS,
  type StepUpMethod,
  type StepUpRequirement,
} from '../src/lib/shared/auth-policy';
import {
  authStepUpClaimsDocValidator,
  stepUpMethodValidator,
  stepUpRequirementValidator,
} from './lib/returnValidators';
import { getCurrentUserOrNull } from './auth/access';

type StepUpClaimDoc = Doc<'authStepUpClaims'>;

const internalClaimArgsValidator = {
  authUserId: v.string(),
  requirement: stepUpRequirementValidator,
  sessionId: v.string(),
};

function getNewestClaim(claims: StepUpClaimDoc[]) {
  return claims.sort((left, right) => right.verifiedAt - left.verifiedAt)[0] ?? null;
}

async function listClaimsForRequirement(
  ctx: QueryCtx | MutationCtx,
  input: {
    authUserId: string;
    requirement: StepUpRequirement;
    sessionId: string;
  },
) {
  return await ctx.db
    .query('authStepUpClaims')
    .withIndex('by_auth_user_id_and_session_id_and_requirement', (queryBuilder) =>
      queryBuilder
        .eq('authUserId', input.authUserId)
        .eq('sessionId', input.sessionId)
        .eq('requirement', input.requirement),
    )
    .collect();
}

export async function getActiveStepUpClaim(
  ctx: QueryCtx | MutationCtx,
  input: {
    authUserId: string;
    now?: number;
    requirement: StepUpRequirement;
    sessionId: string;
  },
) {
  const now = input.now ?? Date.now();
  const claims = await listClaimsForRequirement(ctx, input);
  const activeClaims = claims.filter(
    (claim) =>
      evaluateStepUpClaim({
        claim: {
          consumedAt: claim.consumedAt,
          expiresAt: claim.expiresAt,
          method: claim.method,
          requirement: claim.requirement,
          sessionId: claim.sessionId,
          verifiedAt: claim.verifiedAt,
        },
        now,
        requirement: input.requirement,
        sessionId: input.sessionId,
      }).satisfied,
  );

  return getNewestClaim(activeClaims);
}

async function getLatestClaimForSession(
  ctx: QueryCtx | MutationCtx,
  input: {
    authUserId: string;
    sessionId: string;
  },
) {
  const claims = await ctx.db
    .query('authStepUpClaims')
    .withIndex('by_auth_user_id', (queryBuilder) => queryBuilder.eq('authUserId', input.authUserId))
    .collect();

  const scopedClaims = claims.filter((claim) => claim.sessionId === input.sessionId);
  return getNewestClaim(scopedClaims);
}

export async function getCompatibilityStepUpClaim(
  ctx: QueryCtx | MutationCtx,
  input: {
    authUserId: string;
    sessionId: string;
  },
) {
  const emailClaim = await getActiveStepUpClaim(ctx, {
    authUserId: input.authUserId,
    requirement: STEP_UP_REQUIREMENTS.accountEmailChange,
    sessionId: input.sessionId,
  });
  if (emailClaim) {
    return emailClaim;
  }

  return await getLatestClaimForSession(ctx, input);
}

export const getActiveClaimInternal = internalQuery({
  args: internalClaimArgsValidator,
  returns: v.union(authStepUpClaimsDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await getActiveStepUpClaim(ctx, args);
  },
});

export const hasCurrentClaim = query({
  args: {
    requirement: stepUpRequirementValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrNull(ctx);
    if (!currentUser?.authUserId) {
      return false;
    }

    if (!currentUser.authSession?.id) {
      return false;
    }

    const claim = await getActiveStepUpClaim(ctx, {
      authUserId: currentUser.authUserId,
      requirement: args.requirement,
      sessionId: currentUser.authSession.id,
    });

    return claim !== null;
  },
});

export const getCurrentCompatibilityClaim = query({
  args: {},
  returns: v.union(authStepUpClaimsDocValidator, v.null()),
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrNull(ctx);
    if (!currentUser?.authUserId) {
      return null;
    }

    if (!currentUser.authSession?.id) {
      return null;
    }

    return await getCompatibilityStepUpClaim(ctx, {
      authUserId: currentUser.authUserId,
      sessionId: currentUser.authSession.id,
    });
  },
});

export const issueClaimInternal = internalMutation({
  args: {
    ...internalClaimArgsValidator,
    method: stepUpMethodValidator,
    resourceId: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  returns: authStepUpClaimsDocValidator,
  handler: async (ctx, args) => {
    if (!isStepUpMethodAllowed(args.requirement, args.method)) {
      throw new ConvexError(
        `Step-up method ${args.method} is not allowed for ${args.requirement}.`,
      );
    }

    const now = Date.now();
    const policy = getStepUpRequirementPolicy(args.requirement);
    const currentClaim = await getActiveStepUpClaim(ctx, {
      authUserId: args.authUserId,
      now,
      requirement: args.requirement,
      sessionId: args.sessionId,
    });

    const nextFields = {
      authUserId: args.authUserId,
      claimId: currentClaim?.claimId ?? crypto.randomUUID(),
      consumedAt: null,
      expiresAt: now + policy.ttlMs,
      method: args.method,
      requirement: args.requirement,
      resourceId: args.resourceId ?? null,
      resourceType: args.resourceType ?? null,
      sessionId: args.sessionId,
      updatedAt: now,
      verifiedAt: now,
    } as const;

    if (currentClaim) {
      await ctx.db.patch(currentClaim._id, nextFields);
      const updatedClaim = await ctx.db.get(currentClaim._id);
      if (!updatedClaim) {
        throw new ConvexError('Step-up claim could not be reloaded.');
      }
      return updatedClaim;
    }

    const claimId = await ctx.db.insert('authStepUpClaims', {
      ...nextFields,
      createdAt: now,
    });
    const createdClaim = await ctx.db.get(claimId);
    if (!createdClaim) {
      throw new ConvexError('Step-up claim could not be created.');
    }
    return createdClaim;
  },
});

export const consumeClaimInternal = internalMutation({
  args: {
    ...internalClaimArgsValidator,
  },
  returns: v.union(authStepUpClaimsDocValidator, v.null()),
  handler: async (ctx, args) => {
    const policy = getStepUpRequirementPolicy(args.requirement);
    if (policy.reusable) {
      return await getActiveStepUpClaim(ctx, args);
    }

    const claim = await getActiveStepUpClaim(ctx, args);
    if (!claim) {
      return null;
    }

    await ctx.db.patch(claim._id, {
      consumedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return await ctx.db.get(claim._id);
  },
});

export const listCurrentClaimMethods = query({
  args: {},
  returns: v.array(stepUpMethodValidator),
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrNull(ctx);
    if (!currentUser?.authUserId) {
      return [];
    }

    if (!currentUser.authSession?.id) {
      return [];
    }

    const latestClaim = await getLatestClaimForSession(ctx, {
      authUserId: currentUser.authUserId,
      sessionId: currentUser.authSession.id,
    });

    return latestClaim ? [latestClaim.method] : [];
  },
});

export const STEP_UP_CLAIMABLE_METHODS = [
  STEP_UP_METHODS.passkey,
  STEP_UP_METHODS.passwordPlusTotp,
  STEP_UP_METHODS.totp,
] as const satisfies readonly StepUpMethod[];
