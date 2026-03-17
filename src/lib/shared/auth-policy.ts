export const STEP_UP_REQUIREMENTS = {
  accountEmailChange: 'account_email_change',
  auditExport: 'audit_export',
  attachmentAccess: 'attachment_access',
  documentExport: 'document_export',
  documentDeletion: 'document_deletion',
  organizationAdmin: 'organization_admin',
  sessionAdministration: 'session_administration',
  userAdministration: 'user_administration',
} as const;

export type StepUpRequirement =
  (typeof STEP_UP_REQUIREMENTS)[keyof typeof STEP_UP_REQUIREMENTS];

export type AuthAssuranceState = {
  emailVerified: boolean;
  mfaEnabled: boolean;
  recentStepUpAt: number | null;
};

export type StepUpEvaluation = {
  requirement: StepUpRequirement | null;
  required: boolean;
  satisfied: boolean;
  verifiedAt: number | null;
  validUntil: number | null;
};

export type AuthPolicyEvaluation = {
  requiresMfaSetup: boolean;
  stepUp: StepUpEvaluation;
};

type TimestampLike = Date | number | string | null | undefined;

export function buildStepUpRedirectSearch(requirement: StepUpRequirement) {
  return {
    requirement,
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
    verifiedAt,
    validUntil,
  };
}

export function evaluateStepUpRequirement(input: {
  assurance: AuthAssuranceState;
  now?: number;
  recentStepUpWindowMs: number;
  requirement?: StepUpRequirement | null;
}): StepUpEvaluation {
  const now = input.now ?? Date.now();
  const verifiedAt = input.assurance.recentStepUpAt;
  const validUntil =
    verifiedAt === null ? null : verifiedAt + input.recentStepUpWindowMs;
  const satisfied = validUntil !== null && validUntil > now;

  return {
    requirement: input.requirement ?? null,
    required: input.requirement !== undefined && input.requirement !== null,
    satisfied,
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
