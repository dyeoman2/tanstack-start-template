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
import { evaluateFreshSession } from '../../src/lib/shared/auth-policy';
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

  return {
    origin: siteUrl.origin,
    rpID: siteUrl.hostname,
    rpName: process.env.APP_NAME?.trim() || 'TanStack Start Template',
  };
}

function shouldDisableAuthRateLimit() {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
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

        if (ctx.path.startsWith('/scim/v2/Users/') && ctx.method === 'DELETE') {
          throw new APIError('FORBIDDEN', {
            message:
              'Direct Better Auth SCIM deletion is disabled; use the org-scoped lifecycle handler.',
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
        jwks: process.env.JWKS,
        options: {
          basePath: '/api/auth',
        },
      }),
    ],
  };
}
