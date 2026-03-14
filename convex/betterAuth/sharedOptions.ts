import { convexAdapter } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { BetterAuthOptions } from 'better-auth';
import { admin, createAccessControl, organization } from 'better-auth/plugins';
import {
  getBetterAuthBaseUrlConfig,
  getBetterAuthTrustedOrigins,
  getSiteUrl,
} from '../../src/lib/server/env.server';
import authConfig from '../auth.config';

type BetterAuthEmailAndPasswordOptions = NonNullable<BetterAuthOptions['emailAndPassword']>;
type BetterAuthEmailVerificationOptions = NonNullable<BetterAuthOptions['emailVerification']>;
type BetterAuthDatabaseHooks = NonNullable<BetterAuthOptions['databaseHooks']>;
type OrganizationPluginOptions = NonNullable<Parameters<typeof organization>[0]>;

type SharedBetterAuthCallbacks = {
  allowUserToCreateOrganization?: NonNullable<OrganizationPluginOptions['allowUserToCreateOrganization']>;
  afterEmailVerification?: BetterAuthEmailVerificationOptions['afterEmailVerification'];
  databaseHooks?: BetterAuthDatabaseHooks;
  organizationHooks?: OrganizationPluginOptions['organizationHooks'];
  sendInvitationEmail: NonNullable<OrganizationPluginOptions['sendInvitationEmail']>;
  sendResetPassword: NonNullable<BetterAuthEmailAndPasswordOptions['sendResetPassword']>;
  sendVerificationEmail: NonNullable<BetterAuthEmailVerificationOptions['sendVerificationEmail']>;
};

export type SharedSendInvitationEmail = SharedBetterAuthCallbacks['sendInvitationEmail'];

export const ADMIN_IMPERSONATION_SESSION_DURATION_SECONDS = 30 * 60;
export const AUTH_SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const AUTH_SESSION_FRESH_AGE_SECONDS = 24 * 60 * 60;

const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;

const adminAccessControl = createAccessControl({
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'delete',
    'set-password',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
});

const adminRole = adminAccessControl.newRole({
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'delete',
    'set-password',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
});

const userRole = adminAccessControl.newRole({
  user: [],
  session: [],
});

const organizationAccessControl = createAccessControl({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
});

const organizationOwnerRole = organizationAccessControl.newRole({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
});

const organizationAdminRole = organizationAccessControl.newRole({
  organization: ['update'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
});

const organizationMemberRole = organizationAccessControl.newRole({
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ['read'],
});

function shouldDisableAuthRateLimitInDev() {
  try {
    const siteUrl = new URL(getSiteUrl());
    return siteUrl.hostname === 'localhost' || siteUrl.hostname === '127.0.0.1';
  } catch {
    return false;
  }
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
): BetterAuthOptions {
  const disableRateLimit = shouldDisableAuthRateLimitInDev();

  return {
    baseURL: getBetterAuthBaseUrlConfig(),
    database: convexAdapter({} as never, {} as never),
    trustedOrigins: (request) => getBetterAuthTrustedOrigins(request),
    rateLimit: {
      enabled: !disableRateLimit,
      window: DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      max: DEFAULT_RATE_LIMIT_MAX_REQUESTS,
      storage: 'database',
      customRules: createCustomRateLimitRules(),
    },
    advanced: {
      ipAddress: {
        // Trust only the proxy headers we expect our app platform to normalize.
        ipAddressHeaders: ['x-forwarded-for'],
        ipv6Subnet: 64,
      },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
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
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
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
