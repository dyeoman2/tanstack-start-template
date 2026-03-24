import { passkey } from '@better-auth/passkey';
import { scim } from '@better-auth/scim';
import { convexAdapter } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import {
  getBetterAuthTrustedOrigins,
  getBetterAuthUrlForTooling,
  getGoogleOAuthCredentials,
  getRequiredBetterAuthUrl,
  isTrustedBetterAuthOrigin,
  shouldUseSecureAuthCookies,
} from '../../src/lib/server/env.server';
import { getRecentStepUpWindowMs } from '../../src/lib/server/security-config.server';
import {
  evaluateFreshSession,
  STEP_UP_REQUIREMENTS,
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
    path: string;
    reason: string;
    requirement: StepUpRequirement;
    resourceId?: string;
    sessionId?: string;
    userId?: string;
  }) => Promise<void>;
  sendInvitationEmail: NonNullable<OrganizationPluginOptions['sendInvitationEmail']>;
  sendResetPassword: NonNullable<BetterAuthEmailAndPasswordOptions['sendResetPassword']>;
  sendVerificationEmail: NonNullable<BetterAuthEmailVerificationOptions['sendVerificationEmail']>;
  shouldBlockPasswordAuth?: (input: {
    email: string;
    path: '/sign-in/email' | '/sign-up/email';
  }) => Promise<string | null>;
};

export type SharedSendInvitationEmail = SharedBetterAuthCallbacks['sendInvitationEmail'];

export const ADMIN_IMPERSONATION_SESSION_DURATION_SECONDS = 30 * 60;
export const AUTH_SESSION_EXPIRES_IN_SECONDS = 24 * 60 * 60;
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 4 * 60 * 60;
export const AUTH_SESSION_FRESH_AGE_SECONDS = 15 * 60;
export const ORGANIZATION_INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const PASSWORD_AUTH_PATHS = new Set(['/sign-in/email', '/sign-up/email']);
const PASSKEY_AUTH_PATHS = new Set(['/sign-in/passkey']);
const CALLBACK_AUTH_PATH_PREFIXES = ['/callback/', '/oauth2/callback/'] as const;
const ADMIN_STEP_UP_ROUTE_CONFIG = {
  '/admin/list-users': {
    message: 'Verify your account again before viewing the user directory.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'limit',
  },
  '/admin/get-user': {
    message: 'Verify your account again before viewing another user record.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'id',
  },
  '/admin/create-user': {
    message: 'Verify your account again before creating a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'email',
  },
  '/admin/update-user': {
    message: 'Verify your account again before updating another user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/set-role': {
    message: 'Verify your account again before changing a user role.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/ban-user': {
    message: 'Verify your account again before banning a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/unban-user': {
    message: 'Verify your account again before unbanning a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/remove-user': {
    message: 'Verify your account again before deleting a user.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/set-user-password': {
    message: 'Verify your account again before resetting a user password.',
    requirement: STEP_UP_REQUIREMENTS.userAdministration,
    resourceField: 'userId',
  },
  '/admin/impersonate-user': {
    message: 'Verify your account again before impersonating another user.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'userId',
  },
  '/admin/stop-impersonating': {
    message: 'Verify your account again before stopping impersonation.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'sessionId',
  },
  '/admin/list-user-sessions': {
    message: "Verify your account again before viewing another user's sessions.",
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'userId',
  },
  '/admin/revoke-user-session': {
    message: 'Verify your account again before revoking a user session.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'sessionId',
  },
  '/admin/revoke-user-sessions': {
    message: 'Verify your account again before revoking all user sessions.',
    requirement: STEP_UP_REQUIREMENTS.sessionAdministration,
    resourceField: 'userId',
  },
} as const satisfies Record<
  string,
  {
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

function shouldDisableAuthRateLimit() {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true'
  );
}

function createCustomRateLimitRules(): NonNullable<BetterAuthOptions['rateLimit']>['customRules'] {
  return {
    '/sign-in/email': {
      window: 15 * 60,
      max: 10,
    },
    '/sign-in/passkey': {
      window: 15 * 60,
      max: 20,
    },
    '/sign-up/email': {
      window: 60 * 60,
      max: 5,
    },
    '/request-password-reset': {
      window: 60 * 60,
      max: 3,
    },
    '/forget-password': {
      window: 60 * 60,
      max: 3,
    },
    '/reset-password': {
      window: 15 * 60,
      max: 5,
    },
    '/send-verification-email': {
      window: 60 * 60,
      max: 3,
    },
    '/verify-email': {
      window: 60 * 60,
      max: 10,
    },
    '/change-email': {
      window: 60 * 60,
      max: 5,
    },
    '/change-password': {
      window: 60 * 60,
      max: 5,
    },
    '/get-session': {
      window: 60,
      max: 300,
    },
    // This internal token refresh endpoint can be hit concurrently by the app shell,
    // Convex auth refresh, and tab reloads. Database-backed rate limiting here causes
    // avoidable optimistic concurrency conflicts in Convex and can disrupt auth flows.
    '/convex/token': false,
    '/admin/list-users': {
      window: 15 * 60,
      max: 30,
    },
    '/admin/get-user': {
      window: 15 * 60,
      max: 30,
    },
    '/admin/create-user': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/update-user': {
      window: 15 * 60,
      max: 20,
    },
    '/admin/set-role': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/ban-user': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/unban-user': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/remove-user': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/set-user-password': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/impersonate-user': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/stop-impersonating': {
      window: 15 * 60,
      max: 10,
    },
    '/admin/list-user-sessions': {
      window: 15 * 60,
      max: 30,
    },
    '/admin/revoke-user-session': {
      window: 15 * 60,
      max: 20,
    },
    '/admin/revoke-user-sessions': {
      window: 15 * 60,
      max: 10,
    },
  };
}

function assertFreshSessionForChangeEmail(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  if (ctx.path !== '/change-email') {
    return;
  }

  const currentSession = ctx.context.session?.session;
  const freshness = evaluateFreshSession({
    createdAt: currentSession?.createdAt,
    updatedAt: currentSession?.updatedAt,
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
  });

  if (freshness.satisfied) {
    return;
  }

  throw new APIError('FORBIDDEN', {
    message: 'Verify your account again before changing your sign-in email address.',
  });
}

async function assertProtectedAdminRouteSession(
  callbacks: Pick<SharedBetterAuthCallbacks, 'recordAdminStepUpChallenge'>,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const routeConfig =
    ADMIN_STEP_UP_ROUTE_CONFIG[ctx.path as keyof typeof ADMIN_STEP_UP_ROUTE_CONFIG];
  if (!routeConfig) {
    return;
  }

  const currentSession = ctx.context.session?.session;
  const actorUserId = ctx.context.session?.user?.id;
  const resourceId =
    getStringField(ctx.body, routeConfig.resourceField) ??
    getStringField(ctx.query, routeConfig.resourceField);

  if (currentSession?.impersonatedBy) {
    await callbacks.recordAdminStepUpChallenge?.({
      path: ctx.path,
      reason: 'Impersonated sessions cannot perform privileged admin actions.',
      requirement: routeConfig.requirement,
      resourceId,
      sessionId: currentSession.id,
      userId: actorUserId,
    });
    throw new APIError('FORBIDDEN', {
      message: 'Impersonated sessions cannot perform privileged admin actions.',
    });
  }

  const freshness = evaluateFreshSession({
    createdAt: currentSession?.createdAt,
    updatedAt: currentSession?.updatedAt,
    recentStepUpWindowMs: getRecentStepUpWindowMs(),
    requirement: routeConfig.requirement,
  });

  if (freshness.satisfied) {
    return;
  }

  await callbacks.recordAdminStepUpChallenge?.({
    path: ctx.path,
    reason: routeConfig.message,
    requirement: routeConfig.requirement,
    resourceId,
    sessionId: currentSession?.id,
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

  const updatePayload: Record<string, string | null> = {
    authMethod: resolution.authMethod,
    enterpriseOrganizationId: null,
    enterpriseProviderKey: null,
    enterpriseProtocol: null,
  };

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
      updatePayload.enterpriseOrganizationId = enterpriseSession.organizationId;
      updatePayload.enterpriseProviderKey = enterpriseSession.providerKey;
      updatePayload.enterpriseProtocol = enterpriseSession.protocol;
      updatePayload.activeOrganizationId = enterpriseSession.organizationId;
    }
  }

  await ctx.context.internalAdapter.updateSession(newSession.session.token, updatePayload);
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
  const disableRateLimit = shouldDisableAuthRateLimit();
  const secureCookies = includeRuntimeEnvConfig ? shouldUseSecureAuthCookies(betterAuthUrl) : false;
  const googleOAuthCredentials = includeRuntimeEnvConfig ? getGoogleOAuthCredentials() : null;

  return {
    appName: process.env.APP_NAME?.trim() || 'TanStack Start Template',
    database: convexAdapter({} as never, {} as never),
    ...(includeRuntimeEnvConfig
      ? {
          trustedOrigins: (request?: Request) =>
            getBetterAuthTrustedOrigins(request, betterAuthUrl),
          rateLimit: {
            enabled: !disableRateLimit,
            window: DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
            max: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
            storage: 'database',
            modelName: 'rateLimit',
            customRules: createCustomRateLimitRules(),
          },
        }
      : {}),
    advanced: {
      useSecureCookies: secureCookies,
      ipAddress: {
        // Trust only the proxy headers we expect our app platform to normalize.
        ipAddressHeaders: ['x-forwarded-for'],
        ipv6Subnet: 64,
      },
      defaultCookieAttributes: {
        secure: secureCookies,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    },
    account: {
      accountLinking: {
        allowDifferentEmails: false,
        enabled: false,
      },
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

        assertFreshSessionForChangeEmail(ctx);
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
      }),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
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
