import { convexAdapter } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { scim } from '@better-auth/scim';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins/admin';
import { organization } from 'better-auth/plugins/organization';
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
  getBetterAuthBaseUrlConfig,
  getBetterAuthTrustedOrigins,
  getGoogleOAuthCredentials,
  shouldUseSecureAuthCookies,
} from '../../src/lib/server/env.server';
import authConfig from '../auth.config';

type BetterAuthEmailAndPasswordOptions = NonNullable<BetterAuthOptions['emailAndPassword']>;
type BetterAuthEmailVerificationOptions = NonNullable<BetterAuthOptions['emailVerification']>;
type BetterAuthDatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;
type OrganizationPluginOptions = NonNullable<Parameters<typeof organization>[0]>;

type SharedBetterAuthCallbacks = {
  allowUserToCreateOrganization?: NonNullable<OrganizationPluginOptions['allowUserToCreateOrganization']>;
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
export const AUTH_SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const AUTH_SESSION_FRESH_AGE_SECONDS = 24 * 60 * 60;

const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;

function shouldDisableAuthRateLimit() {
  const envValue = process.env.BETTER_AUTH_DISABLE_RATE_LIMIT?.trim().toLowerCase();
  if (envValue === 'true') {
    return true;
  }

  if (envValue === 'false') {
    return false;
  }

  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

function createCustomRateLimitRules(): NonNullable<BetterAuthOptions['rateLimit']>['customRules'] {
  return {
    '/sign-in/email': {
      window: 15 * 60,
      max: 10,
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
    '/get-session': {
      window: 60,
      max: 300,
    },
    '/convex/token': {
      window: 60,
      max: 300,
    },
    '/admin/impersonate-user': {
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

export function createSharedBetterAuthOptions(
  callbacks: SharedBetterAuthCallbacks,
  options?: {
    includeRuntimeEnvConfig?: boolean;
  },
): BetterAuthOptions {
  const includeRuntimeEnvConfig = options?.includeRuntimeEnvConfig ?? true;
  const disableRateLimit = shouldDisableAuthRateLimit();
  const secureCookies = includeRuntimeEnvConfig ? shouldUseSecureAuthCookies() : false;
  const googleOAuthCredentials = includeRuntimeEnvConfig ? getGoogleOAuthCredentials() : null;

  return {
    ...(includeRuntimeEnvConfig ? { baseURL: getBetterAuthBaseUrlConfig() } : {}),
    database: convexAdapter({} as never, {} as never),
    ...(includeRuntimeEnvConfig
      ? {
          trustedOrigins: (request?: Request) => getBetterAuthTrustedOrigins(request),
          rateLimit: {
            enabled: !disableRateLimit,
            window: DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
            max: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
            storage: 'database',
            customRules: createCustomRateLimitRules(),
          },
        }
      : {}),
    advanced: {
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
        if (
          callbacks.shouldBlockPasswordAuth &&
          (ctx.path === '/sign-in/email' || ctx.path === '/sign-up/email')
        ) {
          const email =
            typeof ctx.body?.email === 'string' ? ctx.body.email.trim().toLowerCase() : null;
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

        if (
          callbacks.assertSCIMManagementAccess &&
          ctx.context.session &&
          (ctx.path === '/scim/generate-token' ||
            ctx.path === '/scim/list-provider-connections' ||
            ctx.path === '/scim/get-provider-connection' ||
            ctx.path === '/scim/delete-provider-connection')
        ) {
          const providerId =
            typeof ctx.body?.providerId === 'string'
              ? ctx.body.providerId
              : typeof ctx.query?.providerId === 'string'
                ? ctx.query.providerId
                : undefined;
          const organizationId =
            typeof ctx.body?.organizationId === 'string' ? ctx.body.organizationId : undefined;

          await callbacks.assertSCIMManagementAccess({
            organizationId,
            path: ctx.path,
            providerId,
            userId: ctx.context.session.user.id,
          });
        }

        if (ctx.path.startsWith('/scim/v2/Users/') && ctx.method === 'DELETE') {
          throw new APIError('FORBIDDEN', {
            message: 'Direct Better Auth SCIM deletion is disabled; use the org-scoped lifecycle handler.',
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path !== '/sign-in/email' &&
          ctx.path !== '/sign-up/email' &&
          !ctx.path.startsWith('/callback/') &&
          !ctx.path.startsWith('/oauth2/callback/')
        ) {
          return;
        }

        const newSession = ctx.context.newSession;
        if (!newSession?.session.token || !newSession.user) {
          return;
        }

        const updatePayload: Record<string, string | null> = {
          authMethod: null,
          enterpriseOrganizationId: null,
          enterpriseProviderKey: null,
          enterpriseProtocol: null,
        };

        if (ctx.path === '/sign-in/email' || ctx.path === '/sign-up/email') {
          updatePayload.authMethod = 'password';
        } else {
          updatePayload.authMethod = 'social';
          const providerId =
            typeof ctx.params?.providerId === 'string' && ctx.params.providerId.length > 0
              ? ctx.params.providerId
              : typeof ctx.params?.id === 'string' && ctx.params.id.length > 0
                ? ctx.params.id
                : null;
          if (providerId && callbacks.resolveEnterpriseAuthSession) {
            const enterpriseSession = await callbacks.resolveEnterpriseAuthSession({
              providerId,
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
        }

        await ctx.context.internalAdapter.updateSession(newSession.session.token, updatePayload);
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
      // Prefer immediate session revalidation so admin revokes and impersonation changes
      // take effect without a client-side cache window.
      cookieCache: {
        enabled: false,
      },
    },
    user: {
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
        invitationExpiresIn: 7 * 24 * 60 * 60,
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
