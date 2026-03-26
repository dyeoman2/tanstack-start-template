export const STEP_UP_REQUIREMENTS = {
  accountEmailChange: 'account_email_change',
  auditExport: 'audit_export',
  attachmentAccess: 'attachment_access',
  documentExport: 'document_export',
  documentDeletion: 'document_deletion',
  organizationAdmin: 'organization_admin',
  passwordChange: 'password_change',
  sessionAdministration: 'session_administration',
  supportAccessApproval: 'support_access_approval',
  userAdministration: 'user_administration',
} as const;

export type StepUpRequirement = (typeof STEP_UP_REQUIREMENTS)[keyof typeof STEP_UP_REQUIREMENTS];
export const STEP_UP_METHODS = {
  passkey: 'passkey',
  passwordOnly: 'password_only',
  passwordPlusTotp: 'password_plus_totp',
  totp: 'totp',
} as const;

export type StepUpMethod = (typeof STEP_UP_METHODS)[keyof typeof STEP_UP_METHODS];

export type AuthAssuranceState = {
  emailVerified: boolean;
  mfaEnabled: boolean;
  recentStepUpAt: number | null;
};

export type StepUpEvaluation = {
  requirement: StepUpRequirement | null;
  required: boolean;
  satisfied: boolean;
  method: StepUpMethod | null;
  verifiedAt: number | null;
  validUntil: number | null;
};

export type AuthPolicyEvaluation = {
  requiresMfaSetup: boolean;
  stepUp: StepUpEvaluation;
};

type TimestampLike = Date | number | string | null | undefined;
type StepUpClaimSnapshot = {
  consumedAt?: TimestampLike;
  expiresAt: TimestampLike;
  method: StepUpMethod | null;
  requirement: StepUpRequirement;
  sessionId?: string | null;
  verifiedAt: TimestampLike;
};

type StepUpRequirementPolicy = {
  allowedMethods: readonly StepUpMethod[];
  reusable: boolean;
  ttlMs: number;
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const STEP_UP_REQUIREMENT_POLICIES = {
  [STEP_UP_REQUIREMENTS.accountEmailChange]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.auditExport]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.attachmentAccess]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.documentDeletion]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.documentExport]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.organizationAdmin]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: true,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.passwordChange]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.sessionAdministration]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.supportAccessApproval]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
  [STEP_UP_REQUIREMENTS.userAdministration]: {
    allowedMethods: [
      STEP_UP_METHODS.passkey,
      STEP_UP_METHODS.passwordPlusTotp,
      STEP_UP_METHODS.totp,
    ],
    reusable: false,
    ttlMs: FIVE_MINUTES_MS,
  },
} as const satisfies Record<StepUpRequirement, StepUpRequirementPolicy>;

export function buildStepUpRedirectSearch(challengeId: string) {
  return {
    challengeId,
    security: 'step-up-required' as const,
  };
}

function toTimestamp(value: TimestampLike): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function evaluateFreshSession(input: {
  createdAt: TimestampLike;
  updatedAt?: TimestampLike;
  now?: number;
  recentStepUpWindowMs: number;
  requirement?: StepUpRequirement | null;
}): StepUpEvaluation {
  const verifiedAt = toTimestamp(input.updatedAt) ?? toTimestamp(input.createdAt);
  const validUntil = verifiedAt === null ? null : verifiedAt + input.recentStepUpWindowMs;
  const now = input.now ?? Date.now();

  return {
    requirement: input.requirement ?? null,
    required: input.requirement !== undefined && input.requirement !== null,
    satisfied: validUntil !== null && validUntil > now,
    method: null,
    verifiedAt,
    validUntil,
  };
}

export function getStepUpRequirementPolicy(
  requirement: StepUpRequirement,
): StepUpRequirementPolicy {
  return STEP_UP_REQUIREMENT_POLICIES[requirement];
}

export function isStepUpMethodAllowed(
  requirement: StepUpRequirement,
  method: StepUpMethod,
): boolean {
  return getStepUpRequirementPolicy(requirement).allowedMethods.includes(method);
}

export function evaluateStepUpClaim(input: {
  claim: StepUpClaimSnapshot | null;
  now?: number;
  requirement?: StepUpRequirement | null;
  sessionId?: string | null;
}): StepUpEvaluation {
  const now = input.now ?? Date.now();
  const claim = input.claim;
  const verifiedAt = claim ? toTimestamp(claim.verifiedAt) : null;
  const validUntil = claim ? toTimestamp(claim.expiresAt) : null;
  const consumedAt = claim ? toTimestamp(claim.consumedAt) : null;
  const sessionMatches =
    !input.sessionId || !claim?.sessionId || input.sessionId === claim.sessionId;
  const requirementMatches =
    input.requirement === undefined || input.requirement === null
      ? true
      : claim?.requirement === input.requirement;

  return {
    requirement: input.requirement ?? claim?.requirement ?? null,
    required: input.requirement !== undefined && input.requirement !== null,
    satisfied:
      claim !== null &&
      sessionMatches &&
      requirementMatches &&
      consumedAt === null &&
      validUntil !== null &&
      validUntil > now,
    method: claim?.method ?? null,
    verifiedAt,
    validUntil,
  };
}

function evaluateStepUpRequirement(input: {
  assurance: AuthAssuranceState;
  now?: number;
  recentStepUpWindowMs: number;
  requirement?: StepUpRequirement | null;
}): StepUpEvaluation {
  const now = input.now ?? Date.now();
  const verifiedAt = input.assurance.recentStepUpAt;
  const validUntil = verifiedAt === null ? null : verifiedAt + input.recentStepUpWindowMs;
  const satisfied = validUntil !== null && validUntil > now;

  return {
    requirement: input.requirement ?? null,
    required: input.requirement !== undefined && input.requirement !== null,
    satisfied,
    method: null,
    verifiedAt,
    validUntil,
  };
}

export function evaluateAuthPolicy(input: {
  assurance: AuthAssuranceState;
  now?: number;
  recentStepUpWindowMs: number;
  requirement?: StepUpRequirement | null;
}): AuthPolicyEvaluation {
  const now = input.now ?? Date.now();

  return {
    requiresMfaSetup: !input.assurance.mfaEnabled,
    stepUp: evaluateStepUpRequirement({
      assurance: input.assurance,
      now,
      recentStepUpWindowMs: input.recentStepUpWindowMs,
      requirement: input.requirement,
    }),
  };
}
