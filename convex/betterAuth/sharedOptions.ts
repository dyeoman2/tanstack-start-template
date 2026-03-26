import { passkey } from '@better-auth/passkey';
import { scim } from '@better-auth/scim';
import { convexAdapter } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { haveIBeenPwned } from 'better-auth/plugins';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import {
  AUTH_PROXY_IP_HEADER,
  getTrustedClientIp,
  getTrustedUserAgent,
} from '../../src/lib/shared/better-auth-http';
import {
  getBetterAuthTrustedOrigins,
  getBetterAuthSecretForTooling,
  getBetterAuthSecret,
  getBetterAuthSecrets,
  getBetterAuthUrlForTooling,
  getGoogleOAuthCredentials,
  getRequiredBetterAuthUrl,
  isDevelopmentOrTestDeployment,
  isTrustedBetterAuthOrigin,
  shouldUseSecureAuthCookies,
} from '../../src/lib/server/env.server';
import {
  clearPendingStepUpCookie,
  hasPendingStepUpCookie,
  parsePendingStepUpCookie,
} from '../../src/lib/server/step-up-cookie.server';
import {
  STEP_UP_REQUIREMENTS,
  STEP_UP_METHODS,
  type StepUpMethod,
  type StepUpRequirement,
} from '../../src/lib/shared/auth-policy';
import {
  adminAccessControl,
  adminRole,
  organizationAccessControl,
  organizationAdminRole,
  organizationMemberRole,
  organizationOwnerRole,
  userRole,
} from '../../src/lib/shared/better-auth-access';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordComplexity,
} from '../../src/lib/shared/password-validation';
import authConfig from '../auth.config';
import { resolveBetterAuthPluginJwks } from './staticJwks';

type BetterAuthEmailAndPasswordOptions = NonNullable<BetterAuthOptions['emailAndPassword']>;
type BetterAuthEmailVerificationOptions = NonNullable<BetterAuthOptions['emailVerification']>;
type BetterAuthDatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;
type BetterAuthUserOptions = NonNullable<BetterAuthOptions['user']>;
export type OrganizationPluginOptions = NonNullable<Parameters<typeof organization>[0]>;

type SharedBetterAuthCallbacks = {
  allowUserToCreateOrganization?: NonNullable<
    OrganizationPluginOptions['allowUserToCreateOrganization']
  >;
  afterEmailVerification?: BetterAuthEmailVerificationOptions['afterEmailVerification'];
  afterSCIMTokenGenerated?: (input: {
    organizationId: string | null;
    providerId: string;
    scimToken: string;
    userId: string;
  }) => Promise<void>;
  assertSCIMManagementAccess?: (input: {
    organizationId?: string;
    path: string;
    providerId?: string;
    userId: string;
  }) => Promise<void>;
  databaseHooks?: BetterAuthDatabaseHooks;
  sendChangeEmailConfirmation?: NonNullable<
    NonNullable<BetterAuthUserOptions['changeEmail']>['sendChangeEmailConfirmation']
  >;
  organizationHooks?: OrganizationPluginOptions['organizationHooks'];
  resolveEnterpriseAuthSession?: (input: {
    providerId: string;
    userEmail: string;
    userId: string;
  }) => Promise<{
    organizationId: string;
    protocol: 'oidc';
    providerKey: 'google-workspace' | 'entra' | 'okta';
  } | null>;
  recordAdminStepUpChallenge?: (input: {
    ipAddress?: string;
    path: string;
    reason: string;
    requirement: StepUpRequirement;
    resourceId?: string;
    requestId?: string;
    sessionId?: string;
    userAgent?: string;
    userId?: string;
  }) => Promise<void>;
  recordStepUpCompletion?: (input: {
    method: StepUpMethod;
    path: string;
    requirement: StepUpRequirement;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  recordStepUpRequired?: (input: {
    path: string;
    reason: string;
    requirement: StepUpRequirement;
    sessionId?: string;
    userId?: string;
  }) => Promise<void>;
  recordStepUpConsumed?: (input: {
    path: string;
    requirement: StepUpRequirement;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  recordStepUpFailure?: (input: {
    path: string;
    reason: string;
    requirement: StepUpRequirement;
    sessionId?: string;
    userId?: string;
  }) => Promise<void>;
  resolveStepUpClaimStatus?: (input: {
    requirement: StepUpRequirement;
    sessionId: string;
    userId: string;
  }) => Promise<boolean>;
  completeStepUpChallenge?: (input: {
    challengeId: string;
    method: StepUpMethod;
    sessionId: string;
    userId: string;
  }) => Promise<
    | {
        ok: true;
        requirement: StepUpRequirement;
      }
    | {
        ok: false;
        reason: string;
        requirement: StepUpRequirement | null;
      }
  >;
  finalizeOAuthAccountState?: (input: { providerId: string; userId: string }) => Promise<void>;
  recordAccountLockout?: (input: {
    email: string;
    reason: string;
    userId?: string;
  }) => Promise<void>;
  recordFailedSignIn?: (email: string) => Promise<{ shouldLock: boolean }>;
  clearFailedSignIn?: (email: string) => Promise<void>;
  consumeStepUpClaim?: (input: {
    requirement: StepUpRequirement;
    sessionId: string;
    userId: string;
  }) => Promise<void>;
  sendInvitationEmail: NonNullable<OrganizationPluginOptions['sendInvitationEmail']>;
  sendResetPassword: NonNullable<BetterAuthEmailAndPasswordOptions['sendResetPassword']>;
  sendVerificationEmail: NonNullable<BetterAuthEmailVerificationOptions['sendVerificationEmail']>;
  checkPasswordReuse?: (input: {
    authUserId: string;
    candidatePassword: string;
  }) => Promise<{ reused: boolean }>;
  recordPasswordChange?: (input: { authUserId: string; passwordHash: string }) => Promise<void>;
  shouldBlockPasswordAuth?: (input: {
    email: string;
    path: '/sign-in/email' | '/sign-up/email';
  }) => Promise<string | null>;
};

export type SharedSendInvitationEmail = SharedBetterAuthCallbacks['sendInvitationEmail'];

export const ADMIN_IMPERSONATION_SESSION_DURATION_SECONDS = 30 * 60;

/**
 * Server-side session ceiling: maximum absolute session lifetime.
 *
 * Even with continuous activity, a session cannot live longer than this.
 * Users must re-authenticate after this period regardless of activity.
 * This is a HIPAA compliance backstop — the client-side inactivity timer
 * handles UX, but the server enforces the hard ceiling.
 */
export const AUTH_SESSION_EXPIRES_IN_SECONDS = 8 * 60 * 60;

/**
 * Server-side idle timeout: sessions are only extended when a request
 * arrives within this window of the last refresh.
 *
 * Set to 15 minutes to match the HIPAA inactivity timeout requirement
 * (§164.312(a)(2)(iii)). If no authenticated request arrives within
 * 15 minutes, the session expires server-side even if the client timer
 * was bypassed.
 */
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 15 * 60;

export const AUTH_SESSION_FRESH_AGE_SECONDS = 15 * 60;
export const ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const PASSWORD_AUTH_PATHS = new Set(['/sign-in/email', '/sign-up/email']);

// ---------------------------------------------------------------------------
// Account lockout: temporary ban after consecutive failed sign-in attempts.
// Tracked per-email in a durable Convex table (authLockoutAttempts) via
// callbacks. Better Auth's native ban/banExpires fields handle the actual
// blocking once a lockout threshold is reached.
// ---------------------------------------------------------------------------

const LOCKOUT_DURATION_MS = 30 * 60 * 1_000; // 30 minutes

/** Endpoints that accept a new password in the request body and must enforce complexity rules. */
const PASSWORD_COMPLEXITY_PATHS: Record<string, string> = {
  '/sign-up/email': 'password',
  '/reset-password': 'newPassword',
  '/change-password': 'newPassword',
  '/admin/set-user-password': 'newPassword',
};
const PASSKEY_AUTH_PATHS = new Set(['/sign-in/passkey', '/passkey/verify-authentication']);
const STEP_UP_TOTP_PATHS = new Set(['/two-factor/verify-totp']);
const STEP_UP_BACKUP_CODE_PATHS = new Set(['/two-factor/verify-backup-code']);
const CALLBACK_AUTH_PATH_PREFIXES = ['/callback/', '/oauth2/callback/'] as const;
const ADMIN_STEP_UP_ROUTE_CONFIG = {
  '/admin/list-users': {
    consumeOnSuccess: false,
    message: 'Verify your account again before viewing the user directory.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'limit',
  },
  '/admin/get-user': {
    consumeOnSuccess: false,
    message: 'Verify your account again before viewing another user record.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'id',
  },
  '/admin/create-user': {
    consumeOnSuccess: true,
    message: 'Verify your account again before creating a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'email',
  },
  '/admin/update-user': {
    consumeOnSuccess: true,
    message: 'Verify your account again before updating another user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/set-role': {
    consumeOnSuccess: true,
    message: 'Verify your account again before changing a user role.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/ban-user': {
    consumeOnSuccess: true,
    message: 'Verify your account again before banning a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/unban-user': {
    consumeOnSuccess: true,
    message: 'Verify your account again before unbanning a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/remove-user': {
    consumeOnSuccess: true,
    message: 'Verify your account again before deleting a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/set-user-password': {
    consumeOnSuccess: true,
    message: 'Verify your account again before resetting a user password.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/impersonate-user': {
    consumeOnSuccess: true,
    message: 'Verify your account again before impersonating another user.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'userId',
  },
  '/admin/stop-impersonating': {
    consumeOnSuccess: true,
    message: 'Verify your account again before stopping impersonation.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'sessionId',
  },
  '/admin/list-user-sessions': {
    consumeOnSuccess: false,
    message: "Verify your account again before viewing another user's sessions.",
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'userId',
  },
  '/admin/revoke-user-session': {
    consumeOnSuccess: true,
    message: 'Verify your account again before revoking a user session.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'sessionId',
  },
  '/admin/revoke-user-sessions': {
    consumeOnSuccess: true,
    message: 'Verify your account again before revoking all user sessions.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'userId',
  },
} as const satisfies Record<
  string,
  {
    consumeOnSuccess: boolean;
    message: string;
    requirement: StepUpRequirement;
    resourceField: string;
  }
>;

type SessionAuthMethodResolution =
  | {
      authMethod: 'passkey' | 'password';
      providerId: null;
    }
  | {
      authMethod: 'social';
      providerId: string | null;
    }
  | null;

function getPasskeyOptions(siteUrlValue: string) {
  const siteUrl = new URL(siteUrlValue);
  const hostname = siteUrl.hostname === '127.0.0.1' ? 'localhost' : siteUrl.hostname;
  const origin =
    hostname === siteUrl.hostname
      ? siteUrl.origin
      : `${siteUrl.protocol}//${hostname}${siteUrl.port ? `:${siteUrl.port}` : ''}`;

  return {
    origin,
    rpID: hostname,
    rpName: process.env.APP_NAME?.trim() || 'TanStack Start Template',
  };
}

/**
 * Returns the rate-limit multiplier for the current deployment context.
 *
 * - Production: 1 (nominal thresholds)
 * - Development / test / local: 10× to keep rate-limit middleware exercised in
 *   CI and local runs without causing spurious failures during integration
 *   tests or rapid manual iteration.
 */
function getAuthRateLimitMultiplier(siteUrl?: string): number {
  if (isDevelopmentOrTestDeployment()) {
    return 10;
  }

  if (siteUrl) {
    try {
      const hostname = new URL(siteUrl).hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 10;
      }
    } catch {
      // Ignore invalid urls and fall through to the environment checks below.
    }
  }

  if (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true'
  ) {
    return 10;
  }

  return 1;
}

function createCustomRateLimitRules(
  multiplier = 1,
): NonNullable<BetterAuthOptions['rateLimit']>['customRules'] {
  const m = (base: number) => base * multiplier;
  return {
    '/sign-in/email': {
      window: 15 * 60,
      max: m(10),
    },
    '/sign-in/passkey': {
      window: 15 * 60,
      max: m(20),
    },
    '/passkey/verify-authentication': {
      window: 15 * 60,
      max: m(20),
    },
    '/sign-up/email': {
      window: 60 * 60,
      max: m(5),
    },
    '/request-password-reset': {
      window: 60 * 60,
      max: m(3),
    },
    '/forget-password': {
      window: 60 * 60,
      max: m(3),
    },
    '/reset-password': {
      window: 15 * 60,
      max: m(5),
    },
    '/send-verification-email': {
      window: 60 * 60,
      max: m(3),
    },
    '/verify-email': {
      window: 60 * 60,
      max: m(10),
    },
    '/change-email': {
      window: 60 * 60,
      max: m(5),
    },
    '/change-password': {
      window: 60 * 60,
      max: m(5),
    },
    '/get-session': {
      window: 60,
      max: m(300),
    },
    // This internal token refresh endpoint can be hit concurrently by the app shell,
    // Convex auth refresh, and tab reloads. Database-backed rate limiting here causes
    // avoidable optimistic concurrency conflicts in Convex and can disrupt auth flows.
    '/convex/token': false,
    '/admin/list-users': {
      window: 15 * 60,
      max: m(30),
    },
    '/admin/get-user': {
      window: 15 * 60,
      max: m(30),
    },
    '/admin/create-user': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/update-user': {
      window: 15 * 60,
      max: m(20),
    },
    '/admin/set-role': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/ban-user': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/unban-user': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/remove-user': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/set-user-password': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/impersonate-user': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/stop-impersonating': {
      window: 15 * 60,
      max: m(10),
    },
    '/admin/list-user-sessions': {
      window: 15 * 60,
      max: m(30),
    },
    '/admin/revoke-user-session': {
      window: 15 * 60,
      max: m(20),
    },
    '/admin/revoke-user-sessions': {
      window: 15 * 60,
      max: m(10),
    },
  };
}

const STEP_UP_PROTECTED_PATHS: Record<string, { message: string; requirement: StepUpRequirement }> =
  {
    '/change-email': {
      message: 'Verify your account again before changing your sign-in email address.',
      requirement: STEP_UP_REQUIREMENTS.accountEmailChange,
    },
    '/change-password': {
      message: 'Verify your account again before changing your password.',
      requirement: STEP_UP_REQUIREMENTS.passwordChange,
    },
  };

async function assertStepUpClaimForProtectedPath(
  callbacks: Pick<SharedBetterAuthCallbacks, 'recordStepUpRequired' | 'resolveStepUpClaimStatus'>,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const config = STEP_UP_PROTECTED_PATHS[ctx.path];
  if (!config) {
    return;
  }

  const currentSession = ctx.context.session?.session;
  const actorUserId = ctx.context.session?.user?.id;
  const sessionId = currentSession?.id;

  if (!actorUserId || !sessionId) {
    throw new APIError('FORBIDDEN', {
      message: config.message,
    });
  }

  const satisfied = await callbacks.resolveStepUpClaimStatus?.({
    requirement: config.requirement,
    sessionId,
    userId: actorUserId,
  });

  if (satisfied) {
    return;
  }

  await callbacks.recordStepUpRequired?.({
    path: ctx.path,
    reason: config.message,
    requirement: config.requirement,
    sessionId,
    userId: actorUserId,
  });

  throw new APIError('FORBIDDEN', {
    message: config.message,
  });
}

function getHeaderValue(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  name: string,
) {
  return ctx.request?.headers.get(name) ?? ctx.headers?.get(name) ?? undefined;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getRequestId(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  return normalizeOptionalString(getHeaderValue(ctx, 'x-request-id'));
}

function getIpAddress(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  return getTrustedClientIp(ctx);
}

function getUserAgent(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  return getTrustedUserAgent(ctx);
}

async function assertProtectedAdminRouteSession(
  callbacks: Pick<
    SharedBetterAuthCallbacks,
    'recordAdminStepUpChallenge' | 'resolveStepUpClaimStatus'
  >,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const routeConfig =
    ADMIN_STEP_UP_ROUTE_CONFIG[ctx.path as keyof typeof ADMIN_STEP_UP_ROUTE_CONFIG];
  if (!routeConfig) {
    return;
  }

  const currentSession = ctx.context.session?.session;
  const actorUserId = ctx.context.session?.user?.id;
  const ipAddress = getIpAddress(ctx);
  const requestId = getRequestId(ctx);
  const resourceId =
    getStringField(ctx.body, routeConfig.resourceField) ??
    getStringField(ctx.query, routeConfig.resourceField);
  const userAgent = getUserAgent(ctx);

  if (currentSession?.impersonatedBy) {
    await callbacks.recordAdminStepUpChallenge?.({
      ...(ipAddress ? { ipAddress } : {}),
      path: ctx.path,
      reason: 'Impersonated sessions cannot perform privileged admin actions.',
      requirement: routeConfig.requirement,
      resourceId,
      ...(requestId ? { requestId } : {}),
      sessionId: currentSession.id,
      ...(userAgent ? { userAgent } : {}),
      userId: actorUserId,
    });
    throw new APIError('FORBIDDEN', {
      message: 'Impersonated sessions cannot perform privileged admin actions.',
    });
  }

  if (
    actorUserId &&
    currentSession?.id &&
    (await callbacks.resolveStepUpClaimStatus?.({
      requirement: routeConfig.requirement,
      sessionId: currentSession.id,
      userId: actorUserId,
    }))
  ) {
    return;
  }

  await callbacks.recordAdminStepUpChallenge?.({
    ...(ipAddress ? { ipAddress } : {}),
    path: ctx.path,
    reason: routeConfig.message,
    requirement: routeConfig.requirement,
    resourceId,
    ...(requestId ? { requestId } : {}),
    sessionId: currentSession?.id,
    ...(userAgent ? { userAgent } : {}),
    userId: actorUserId,
  });
  throw new APIError('FORBIDDEN', {
    message: routeConfig.message,
  });
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function resolveSessionAuthMethod(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): SessionAuthMethodResolution {
  if (PASSWORD_AUTH_PATHS.has(ctx.path)) {
    return {
      authMethod: 'password',
      providerId: null,
    };
  }

  if (PASSKEY_AUTH_PATHS.has(ctx.path)) {
    return {
      authMethod: 'passkey',
      providerId: null,
    };
  }

  if (!CALLBACK_AUTH_PATH_PREFIXES.some((prefix) => ctx.path.startsWith(prefix))) {
    return null;
  }

  return {
    authMethod: 'social',
    providerId:
      typeof ctx.params?.providerId === 'string' && ctx.params.providerId.length > 0
        ? ctx.params.providerId
        : typeof ctx.params?.id === 'string' && ctx.params.id.length > 0
          ? ctx.params.id
          : null,
  };
}

async function handleSessionEnrichmentAfterHook(
  callbacks: SharedBetterAuthCallbacks,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const resolution = resolveSessionAuthMethod(ctx);
  if (!resolution) {
    return;
  }

  const newSession = ctx.context.newSession;
  if (!newSession?.session.token || !newSession.user) {
    return;
  }

  const updatePayload: Record<string, boolean | string | null> = {
    authMethod: resolution.authMethod,
    mfaVerified: resolution.authMethod === 'passkey',
    enterpriseOrganizationId: null,
    enterpriseProviderKey: null,
    enterpriseProtocol: null,
  };

  if (
    resolution.authMethod === 'social' &&
    resolution.providerId &&
    callbacks.finalizeOAuthAccountState
  ) {
    await callbacks.finalizeOAuthAccountState({
      providerId: resolution.providerId,
      userId: newSession.user.id,
    });
  }

  if (
    resolution.authMethod === 'social' &&
    resolution.providerId &&
    callbacks.resolveEnterpriseAuthSession
  ) {
    const enterpriseSession = await callbacks.resolveEnterpriseAuthSession({
      providerId: resolution.providerId,
      userEmail: newSession.user.email,
      userId: newSession.user.id,
    });
    if (enterpriseSession) {
      updatePayload.authMethod = 'enterprise';
      updatePayload.mfaVerified = false;
      updatePayload.enterpriseOrganizationId = enterpriseSession.organizationId;
      updatePayload.enterpriseProviderKey = enterpriseSession.providerKey;
      updatePayload.enterpriseProtocol = enterpriseSession.protocol;
      updatePayload.activeOrganizationId = enterpriseSession.organizationId;
    }
  }

  await ctx.context.internalAdapter.updateSession(newSession.session.token, updatePayload);
}

function appendResponseCookie(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  cookie: string,
) {
  if (ctx.context.responseHeaders instanceof Headers) {
    ctx.context.responseHeaders.append('set-cookie', cookie);
    return;
  }

  if ('setHeader' in ctx && typeof ctx.setHeader === 'function') {
    ctx.setHeader('set-cookie', cookie);
  }
}

function resolveStepUpSessionContext(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const newSession = ctx.context.newSession;
  const currentSession = ctx.context.session;

  return {
    sessionId: newSession?.session?.id ?? currentSession?.session?.id ?? null,
    userId: newSession?.user?.id ?? currentSession?.user?.id ?? null,
  };
}

function resolveStepUpMethod(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): StepUpMethod | null {
  if (PASSKEY_AUTH_PATHS.has(ctx.path)) {
    return STEP_UP_METHODS.passkey;
  }

  if (STEP_UP_TOTP_PATHS.has(ctx.path)) {
    return ctx.context.newSession?.session?.id
      ? STEP_UP_METHODS.passwordPlusTotp
      : STEP_UP_METHODS.totp;
  }

  if (STEP_UP_BACKUP_CODE_PATHS.has(ctx.path)) {
    return STEP_UP_METHODS.passwordPlusTotp;
  }

  return null;
}

function resolveSessionMfaVerifiedUpdate(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): boolean | null {
  if (PASSKEY_AUTH_PATHS.has(ctx.path)) {
    return true;
  }

  if (
    PASSWORD_AUTH_PATHS.has(ctx.path) ||
    CALLBACK_AUTH_PATH_PREFIXES.some((prefix) => ctx.path.startsWith(prefix))
  ) {
    return false;
  }

  if (STEP_UP_TOTP_PATHS.has(ctx.path) || STEP_UP_BACKUP_CODE_PATHS.has(ctx.path)) {
    return true;
  }

  return null;
}

async function handleStepUpAfterHook(
  callbacks: SharedBetterAuthCallbacks,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const sessionContext = resolveStepUpSessionContext(ctx);
  const mfaVerified = resolveSessionMfaVerifiedUpdate(ctx);
  const currentSession = ctx.context.session?.session as { token?: string } | undefined;
  const sessionToken = ctx.context.newSession?.session?.token ?? currentSession?.token;
  if (sessionToken && mfaVerified !== null) {
    await ctx.context.internalAdapter.updateSession(sessionToken, {
      mfaVerified,
    });
  }
  const cookieHeader = ctx.headers?.get('cookie');
  const pendingStepUp = parsePendingStepUpCookie(cookieHeader);
  const issuedMethod = resolveStepUpMethod(ctx);

  if (!pendingStepUp && hasPendingStepUpCookie(cookieHeader)) {
    appendResponseCookie(ctx, clearPendingStepUpCookie());
  }

  if (pendingStepUp && sessionContext.sessionId && sessionContext.userId && issuedMethod) {
    const result = await callbacks.completeStepUpChallenge?.({
      challengeId: pendingStepUp.challengeId,
      method: issuedMethod,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
    });

    if (result?.ok) {
      await callbacks.recordStepUpCompletion?.({
        method: issuedMethod,
        path: ctx.path,
        requirement: result.requirement,
        sessionId: sessionContext.sessionId,
        userId: sessionContext.userId,
      });
    } else if (result && result.requirement) {
      await callbacks.recordStepUpFailure?.({
        path: ctx.path,
        reason: result.reason,
        requirement: result.requirement,
        sessionId: sessionContext.sessionId,
        userId: sessionContext.userId,
      });
    }

    appendResponseCookie(ctx, clearPendingStepUpCookie());
  }

  const stepUpProtectedConfig = STEP_UP_PROTECTED_PATHS[ctx.path];
  if (stepUpProtectedConfig && sessionContext.sessionId && sessionContext.userId) {
    await callbacks.consumeStepUpClaim?.({
      requirement: stepUpProtectedConfig.requirement,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
    });
    await callbacks.recordStepUpConsumed?.({
      path: ctx.path,
      requirement: stepUpProtectedConfig.requirement,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
    });
  }

  const adminRouteConfig =
    ADMIN_STEP_UP_ROUTE_CONFIG[ctx.path as keyof typeof ADMIN_STEP_UP_ROUTE_CONFIG];
  if (adminRouteConfig?.consumeOnSuccess && sessionContext.sessionId && sessionContext.userId) {
    await callbacks.consumeStepUpClaim?.({
      requirement: adminRouteConfig.requirement,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
    });
    await callbacks.recordStepUpConsumed?.({
      path: ctx.path,
      requirement: adminRouteConfig.requirement,
      sessionId: sessionContext.sessionId,
      userId: sessionContext.userId,
    });
  }
}

export function createSharedBetterAuthOptions(
  callbacks: SharedBetterAuthCallbacks,
  options?: {
    includeRuntimeEnvConfig?: boolean;
  },
): BetterAuthOptions {
  const includeRuntimeEnvConfig = options?.includeRuntimeEnvConfig ?? true;
  const betterAuthUrl = includeRuntimeEnvConfig
    ? getBetterAuthUrlForTooling()
    : getRequiredBetterAuthUrl();
  const rateLimitMultiplier = getAuthRateLimitMultiplier(betterAuthUrl);
  const secureCookies = includeRuntimeEnvConfig ? shouldUseSecureAuthCookies(betterAuthUrl) : false;
  const googleOAuthCredentials = includeRuntimeEnvConfig ? getGoogleOAuthCredentials() : null;
  const betterAuthSecrets = getBetterAuthSecrets();

  return {
    appName: process.env.APP_NAME?.trim() || 'TanStack Start Template',
    database: convexAdapter({} as never, {} as never),
    secret: includeRuntimeEnvConfig ? getBetterAuthSecretForTooling() : getBetterAuthSecret(),
    ...(betterAuthSecrets ? { secrets: betterAuthSecrets } : {}),
    ...(includeRuntimeEnvConfig
      ? {
          trustedOrigins: (request?: Request) =>
            getBetterAuthTrustedOrigins(request, betterAuthUrl),
          rateLimit: {
            enabled: true,
            window: DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
            max: DEFAULT_RATE_LIMIT_MAX_REQUESTS * rateLimitMultiplier,
            storage: 'database',
            modelName: 'rateLimit',
            customRules: createCustomRateLimitRules(rateLimitMultiplier),
          },
        }
      : {}),
    advanced: {
      useSecureCookies: secureCookies,
      ipAddress: {
        // Prefer the canonical signed app-to-Convex proxy header, but fall back to
        // infrastructure-provided forwarding headers for direct browser-to-Convex
        // Better Auth endpoints like /api/auth/get-session.
        ipAddressHeaders: [AUTH_PROXY_IP_HEADER, 'x-forwarded-for', 'cf-connecting-ip'],
        ipv6Subnet: 64,
      },
      defaultCookieAttributes: {
        secure: secureCookies,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      },
    },
    account: {
      accountLinking: {
        allowDifferentEmails: false,
        enabled: false,
      },
      // Keep provider tokens encrypted at rest, then prune the unused ones after social sign-in.
      encryptOAuthTokens: true,
      updateAccountOnSignIn: true,
    },
    socialProviders: googleOAuthCredentials
      ? {
          google: googleOAuthCredentials,
        }
      : undefined,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const requestOrigin = ctx.headers?.get('origin') ?? undefined;
        if (requestOrigin && !isTrustedBetterAuthOrigin(requestOrigin)) {
          throw new APIError('FORBIDDEN', {
            message: 'Origin is not allowed for this authentication request.',
          });
        }

        // Enforce password complexity and reuse prevention on endpoints that accept a new password.
        const passwordField = PASSWORD_COMPLEXITY_PATHS[ctx.path];
        const candidatePassword = passwordField
          ? getStringField(ctx.body, passwordField)
          : undefined;

        if (passwordField && candidatePassword) {
          const { valid, errors } = validatePasswordComplexity(candidatePassword);
          if (!valid) {
            throw new APIError('BAD_REQUEST', {
              message: `Password does not meet complexity requirements: ${errors.join('; ')}`,
            });
          }
        }

        // Check password reuse after complexity validation passes.
        if (passwordField && candidatePassword) {
          const session = ctx.context.session;
          if (session?.user?.id && callbacks.checkPasswordReuse) {
            const { reused } = await callbacks.checkPasswordReuse({
              authUserId: session.user.id,
              candidatePassword,
            });
            if (reused) {
              throw new APIError('BAD_REQUEST', {
                message:
                  'This password has been used recently. Please choose a different password.',
              });
            }
          }
        }

        if (
          callbacks.shouldBlockPasswordAuth &&
          (ctx.path === '/sign-in/email' || ctx.path === '/sign-up/email')
        ) {
          const email = getStringField(ctx.body, 'email')?.trim().toLowerCase() ?? null;
          if (email) {
            const message = await callbacks.shouldBlockPasswordAuth({
              email,
              path: ctx.path as '/sign-in/email' | '/sign-up/email',
            });
            if (message) {
              throw new APIError('FORBIDDEN', {
                message,
              });
            }
          }
        }

        await assertStepUpClaimForProtectedPath(callbacks, ctx);
        await assertProtectedAdminRouteSession(callbacks, ctx);

        if (
          callbacks.assertSCIMManagementAccess &&
          ctx.context.session &&
          (ctx.path === '/scim/generate-token' ||
            ctx.path === '/scim/list-provider-connections' ||
            ctx.path === '/scim/get-provider-connection' ||
            ctx.path === '/scim/delete-provider-connection')
        ) {
          const providerId =
            getStringField(ctx.body, 'providerId') ?? getStringField(ctx.query, 'providerId');
          const organizationId = getStringField(ctx.body, 'organizationId');

          await callbacks.assertSCIMManagementAccess({
            organizationId,
            path: ctx.path,
            providerId,
            userId: ctx.context.session.user.id,
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        await handleSessionEnrichmentAfterHook(callbacks, ctx);
        await handleStepUpAfterHook(callbacks, ctx);

        // Record successful password changes in history for reuse prevention.
        if (ctx.path === '/change-password' || ctx.path === '/reset-password') {
          const returned = ctx.context.returned as { status?: number } | undefined;
          if (returned?.status === 200 && ctx.context.session?.user?.id) {
            try {
              const user = await ctx.context.internalAdapter.findUserByEmail(
                ctx.context.session.user.email,
              );
              if (user?.user) {
                const accounts = await ctx.context.internalAdapter.findAccounts(user.user.id);
                const credentialAccount = accounts.find(
                  (a: { providerId: string }) => a.providerId === 'credential',
                );
                if (credentialAccount?.password) {
                  await callbacks.recordPasswordChange?.({
                    authUserId: user.user.id,
                    passwordHash: credentialAccount.password as string,
                  });
                }
              }
            } catch (err) {
              console.warn('[password-history] Failed to record password change:', err);
            }
          }
        }

        // Account lockout: track failed sign-in attempts in durable storage
        // and temporarily ban the user after consecutive failures within the
        // lockout window. Better Auth's native ban/banExpires handle blocking.
        if (ctx.path === '/sign-in/email') {
          const email = getStringField(ctx.body, 'email')?.trim().toLowerCase();
          if (email) {
            const returned = ctx.context.returned as { status?: number } | undefined;
            const responseStatus = returned?.status;
            if (responseStatus && responseStatus >= 400) {
              try {
                const result = await callbacks.recordFailedSignIn?.(email);
                if (result?.shouldLock) {
                  await callbacks.clearFailedSignIn?.(email);
                  const user = await ctx.context.internalAdapter.findUserByEmail(email);
                  if (user?.user) {
                    await ctx.context.internalAdapter.updateUser(user.user.id, {
                      banned: true,
                      banReason: 'Too many failed sign-in attempts',
                      banExpires: Date.now() + LOCKOUT_DURATION_MS,
                    });
                    await callbacks.recordAccountLockout?.({
                      email,
                      reason: 'Too many failed sign-in attempts',
                      userId: user.user.id,
                    });
                  }
                }
              } catch (err) {
                console.warn('[account-lockout] Failed to apply temporary ban:', err);
              }
            } else if (responseStatus === 200) {
              await callbacks.clearFailedSignIn?.(email).catch((err: unknown) => {
                console.warn('[account-lockout] Failed to clear lockout attempts:', err);
              });
            }
          }
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: callbacks.sendResetPassword,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: callbacks.sendVerificationEmail,
      afterEmailVerification: callbacks.afterEmailVerification,
    },
    session: {
      expiresIn: AUTH_SESSION_EXPIRES_IN_SECONDS,
      updateAge: AUTH_SESSION_UPDATE_AGE_SECONDS,
      freshAge: AUTH_SESSION_FRESH_AGE_SECONDS,
      // We intentionally keep DB-backed sessions so revocation and admin session tooling reflect
      // server state immediately, even though that makes active session tokens sensitive DB records.
      storeSessionInDatabase: true,
      disableSessionRefresh: false,
      deferSessionRefresh: false,
      additionalFields: {
        authMethod: {
          type: 'string',
          required: false,
          input: false,
        },
        enterpriseOrganizationId: {
          type: 'string',
          required: false,
          input: false,
        },
        enterpriseProviderKey: {
          type: 'string',
          required: false,
          input: false,
        },
        enterpriseProtocol: {
          type: 'string',
          required: false,
          input: false,
        },
        mfaVerified: {
          type: 'boolean',
          required: false,
          input: false,
        },
      },
      cookieCache: {
        // Security-sensitive session revocation should reflect server state immediately
        // instead of allowing a cached cookie snapshot to survive briefly on the client.
        enabled: false,
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        ...(callbacks.sendChangeEmailConfirmation
          ? {
              sendChangeEmailConfirmation: callbacks.sendChangeEmailConfirmation,
            }
          : {}),
      },
      additionalFields: {
        phoneNumber: {
          type: 'string',
          required: false,
        },
      },
    },
    ...(callbacks.databaseHooks ? { databaseHooks: callbacks.databaseHooks } : {}),
    plugins: [
      admin({
        ac: adminAccessControl,
        defaultRole: 'user',
        adminRoles: ['admin'],
        impersonationSessionDuration: ADMIN_IMPERSONATION_SESSION_DURATION_SECONDS,
        roles: {
          admin: adminRole,
          user: userRole,
        },
      }),
      organization({
        ac: organizationAccessControl,
        allowUserToCreateOrganization: callbacks.allowUserToCreateOrganization ?? true,
        creatorRole: 'owner',
        invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: true,
        roles: {
          owner: organizationOwnerRole,
          admin: organizationAdminRole,
          member: organizationMemberRole,
        },
        // App-level policy enforcement happens in our server functions because the limit is based
        // on current memberships and site admins bypass it entirely.
        // Keep the plugin in organizations-only mode; team support is intentionally not enabled.
        ...(callbacks.organizationHooks ? { organizationHooks: callbacks.organizationHooks } : {}),
        sendInvitationEmail: callbacks.sendInvitationEmail,
      }),
      scim({
        beforeSCIMTokenGenerated: async ({ member, user }) => {
          await callbacks.assertSCIMManagementAccess?.({
            organizationId: member?.organizationId,
            path: '/scim/generate-token',
            userId: user.id,
          });
        },
        afterSCIMTokenGenerated: async ({ member, scimToken, user }) => {
          await callbacks.afterSCIMTokenGenerated?.({
            organizationId: member?.organizationId ?? null,
            providerId: member?.organizationId
              ? `google-workspace--${member.organizationId}`
              : 'google-workspace',
            scimToken,
            userId: user.id,
          });
        },
        providerOwnership: {
          enabled: true,
        },
        storeSCIMToken: 'hashed',
      }),
      twoFactor({
        issuer: process.env.APP_NAME?.trim() || 'TanStack Start Template',
      }),
      // NIST 800-63B: reject passwords found in known data breaches via the
      // HaveIBeenPwned k-anonymity range API (free, no API key required).
      // Only the first 5 characters of the SHA-1 hash are transmitted.
      haveIBeenPwned(),
      passkey(getPasskeyOptions(betterAuthUrl)),
      convex({
        authConfig,
        jwks: resolveBetterAuthPluginJwks(process.env.JWKS),
        options: {
          basePath: '/api/auth',
        },
      }),
    ],
  };
}
