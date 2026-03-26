import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  evaluateStepUpClaim,
  getStepUpRequirementPolicy,
  isStepUpMethodAllowed,
  STEP_UP_REQUIREMENTS,
  STEP_UP_METHODS,
  type StepUpMethod,
  type StepUpRequirement,
} from '../src/lib/shared/auth-policy';
import { normalizeAppRedirectTarget } from '../src/features/auth/lib/account-setup-routing';
import {
  authStepUpClaimsDocValidator,
  stepUpMethodValidator,
  stepUpChallengeCompletionResultValidator,
  stepUpChallengeSummaryValidator,
  stepUpRequirementValidator,
} from './lib/returnValidators';
import { getCurrentUserOrNull } from './auth/access';

type StepUpClaimDoc = Doc<'authStepUpClaims'>;
type StepUpChallengeDoc = Doc<'authStepUpChallenges'>;

const STEP_UP_CHALLENGE_TTL_MS = 10 * 60 * 1000;

const internalClaimArgsValidator = {
  authUserId: v.string(),
  requirement: stepUpRequirementValidator,
  sessionId: v.string(),
};

const internalChallengeArgsValidator = {
  authUserId: v.string(),
  challengeId: v.string(),
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

async function getChallengeById(
  ctx: QueryCtx | MutationCtx,
  challengeId: string,
): Promise<StepUpChallengeDoc | null> {
  return (
    (await ctx.db
      .query('authStepUpChallenges')
      .withIndex('by_challenge_id', (queryBuilder) => queryBuilder.eq('challengeId', challengeId))
      .unique()) ?? null
  );
}

function isActiveChallenge(
  challenge: StepUpChallengeDoc | null,
  input: {
    authUserId: string;
    sessionId: string;
    now?: number;
  },
) {
  const now = input.now ?? Date.now();

  return (
    challenge !== null &&
    challenge.authUserId === input.authUserId &&
    challenge.sessionId === input.sessionId &&
    challenge.consumedAt === null &&
    challenge.expiresAt > now
  );
}

async function createChallengeForRequirement(
  ctx: MutationCtx,
  input: {
    authUserId: string;
    redirectTo?: string | null;
    requirement: StepUpRequirement;
    sessionId: string;
  },
) {
  const now = Date.now();
  const challengeId = crypto.randomUUID();
  const challengeDocId = await ctx.db.insert('authStepUpChallenges', {
    authUserId: input.authUserId,
    challengeId,
    consumedAt: null,
    createdAt: now,
    expiresAt: now + STEP_UP_CHALLENGE_TTL_MS,
    failureReason: null,
    preparedAt: null,
    redirectTo: normalizeAppRedirectTarget(input.redirectTo),
    requirement: input.requirement,
    sessionId: input.sessionId,
    updatedAt: now,
  });
  const challenge = await ctx.db.get(challengeDocId);
  if (!challenge) {
    throw new ConvexError('Step-up challenge could not be created.');
  }
  return challenge;
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

export const getCurrentChallenge = query({
  args: {
    challengeId: v.string(),
  },
  returns: v.union(stepUpChallengeSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrNull(ctx);
    if (!currentUser?.authUserId || !currentUser.authSession?.id) {
      return null;
    }

    const challenge = await getChallengeById(ctx, args.challengeId);
    if (challenge === null) {
      return null;
    }

    if (
      !isActiveChallenge(challenge, {
        authUserId: currentUser.authUserId,
        sessionId: currentUser.authSession.id,
      })
    ) {
      return null;
    }

    return {
      challengeId: challenge.challengeId,
      redirectTo: challenge.redirectTo,
      requirement: challenge.requirement,
    };
  },
});

function createCurrentChallengeMutation(
  requirement: StepUpRequirement,
  defaultRedirectTo?: string,
) {
  return mutation({
    args: {
      redirectTo: v.optional(v.string()),
    },
    returns: stepUpChallengeSummaryValidator,
    handler: async (ctx, args) => {
      const currentUser = await getCurrentUserOrNull(ctx);
      if (!currentUser?.authUserId || !currentUser.authSession?.id) {
        throw new ConvexError('Authentication is required for step-up challenges.');
      }

      const challenge = await createChallengeForRequirement(ctx, {
        authUserId: currentUser.authUserId,
        redirectTo: args.redirectTo ?? defaultRedirectTo ?? '/app',
        requirement,
        sessionId: currentUser.authSession.id,
      });

      return {
        challengeId: challenge.challengeId,
        redirectTo: challenge.redirectTo,
        requirement: challenge.requirement,
      };
    },
  });
}

export const createCurrentAccountEmailChangeChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.accountEmailChange,
  '/app/profile',
);
export const createCurrentAuditExportChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.auditExport,
);
export const createCurrentAttachmentAccessChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.attachmentAccess,
);
export const createCurrentDocumentExportChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.documentExport,
);
export const createCurrentDocumentDeletionChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.documentDeletion,
);
export const createCurrentOrganizationAdminChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.organizationAdmin,
);
export const createCurrentSessionAdministrationChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.sessionAdministration,
);
export const createCurrentUserAdministrationChallenge = createCurrentChallengeMutation(
  STEP_UP_REQUIREMENTS.userAdministration,
);

export const prepareCurrentChallenge = mutation({
  args: {
    challengeId: v.string(),
  },
  returns: stepUpChallengeSummaryValidator,
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrNull(ctx);
    if (!currentUser?.authUserId || !currentUser.authSession?.id) {
      throw new ConvexError('Authentication is required for step-up challenges.');
    }

    const challenge = await getChallengeById(ctx, args.challengeId);
    if (challenge === null) {
      throw new ConvexError('Step-up challenge is invalid or expired.');
    }

    if (
      !isActiveChallenge(challenge, {
        authUserId: currentUser.authUserId,
        sessionId: currentUser.authSession.id,
      })
    ) {
      throw new ConvexError('Step-up challenge is invalid or expired.');
    }

    await ctx.db.patch(challenge._id, {
      failureReason: null,
      preparedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      challengeId: challenge.challengeId,
      redirectTo: challenge.redirectTo,
      requirement: challenge.requirement,
    };
  },
});

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

export const completeChallengeInternal = internalMutation({
  args: {
    ...internalChallengeArgsValidator,
    method: stepUpMethodValidator,
  },
  returns: stepUpChallengeCompletionResultValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const challenge = await getChallengeById(ctx, args.challengeId);
    if (challenge === null) {
      return {
        ok: false as const,
        reason: 'Step-up challenge is invalid or expired.',
        requirement: null,
      };
    }

    if (
      !isActiveChallenge(challenge, {
        authUserId: args.authUserId,
        now,
        sessionId: args.sessionId,
      })
    ) {
      if (challenge.authUserId === args.authUserId && challenge.sessionId === args.sessionId) {
        await ctx.db.patch(challenge._id, {
          failureReason: 'Step-up challenge is invalid or expired.',
          updatedAt: now,
        });
      }

      return {
        ok: false as const,
        reason: 'Step-up challenge is invalid or expired.',
        requirement: challenge.requirement,
      };
    }

    if (challenge.preparedAt === null) {
      await ctx.db.patch(challenge._id, {
        failureReason: 'Step-up challenge was not prepared.',
        updatedAt: now,
      });

      return {
        ok: false as const,
        reason: 'Step-up challenge was not prepared.',
        requirement: challenge.requirement,
      };
    }

    if (!isStepUpMethodAllowed(challenge.requirement, args.method)) {
      await ctx.db.patch(challenge._id, {
        failureReason: `Step-up method ${args.method} is not allowed for ${challenge.requirement}.`,
        updatedAt: now,
      });

      return {
        ok: false as const,
        reason: `Step-up method ${args.method} is not allowed for ${challenge.requirement}.`,
        requirement: challenge.requirement,
      };
    }

    const policy = getStepUpRequirementPolicy(challenge.requirement);
    const currentClaim = await getActiveStepUpClaim(ctx, {
      authUserId: args.authUserId,
      now,
      requirement: challenge.requirement,
      sessionId: args.sessionId,
    });

    const nextClaimFields = {
      authUserId: args.authUserId,
      claimId: currentClaim?.claimId ?? crypto.randomUUID(),
      consumedAt: null,
      expiresAt: now + policy.ttlMs,
      method: args.method,
      requirement: challenge.requirement,
      resourceId: null,
      resourceType: null,
      sessionId: args.sessionId,
      updatedAt: now,
      verifiedAt: now,
    } as const;

    if (currentClaim) {
      await ctx.db.patch(currentClaim._id, nextClaimFields);
    } else {
      await ctx.db.insert('authStepUpClaims', {
        ...nextClaimFields,
        createdAt: now,
      });
    }

    await ctx.db.patch(challenge._id, {
      consumedAt: now,
      failureReason: null,
      updatedAt: now,
    });

    return {
      ok: true as const,
      requirement: challenge.requirement,
    };
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
