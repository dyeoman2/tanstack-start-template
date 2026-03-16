import { passkeyClient } from '@better-auth/passkey/client';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthHooks } from '@daveyplate/better-auth-tanstack';
import {
  adminClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { useSyncExternalStore } from 'react';
import {
  adminAccessControl,
  adminRole,
  organizationAccessControl,
  organizationAdminRole,
  organizationMemberRole,
  organizationOwnerRole,
  userRole,
} from '~/lib/shared/better-auth-access';
import type { getOptions } from '../../../convex/betterAuth/options';

export function getTwoFactorRedirectHref(currentHref: string): string {
  const currentUrl = new URL(currentHref);
  const nextUrl = new URL('/two-factor', currentUrl.origin);
  const redirectTo = currentUrl.searchParams.get('redirectTo');

  if (redirectTo) {
    nextUrl.searchParams.set('redirectTo', redirectTo);
  }

  return `${nextUrl.pathname}${nextUrl.search}`;
}

function navigateWithBrowser(href: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.history.pushState(window.history.state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const rawAuthClient = createAuthClient({
  plugins: [
    convexClient(),
    inferAdditionalFields<ReturnType<typeof getOptions>>(),
    adminClient({
      ac: adminAccessControl,
      roles: {
        admin: adminRole,
        user: userRole,
      },
    }),
    // Match the server plugin configuration: organizations enabled, teams intentionally omitted.
    organizationClient({
      ac: organizationAccessControl,
      roles: {
        admin: organizationAdminRole,
        member: organizationMemberRole,
        owner: organizationOwnerRole,
      },
    }),
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect: async () => {
        if (typeof window === 'undefined') {
          return;
        }

        // Keep the Better Auth 2FA callback narrowly focused on navigation so
        // auth client wiring does not become a second routing abstraction.
        navigateWithBrowser(getTwoFactorRedirectHref(window.location.href));
      },
    }),
  ],
});

type AppAuthClient = {
  $Infer: typeof rawAuthClient.$Infer;
  $store: typeof rawAuthClient.$store;
  changeEmail: typeof rawAuthClient.changeEmail;
  changePassword: typeof rawAuthClient.changePassword;
  getSession: typeof rawAuthClient.getSession;
  requestPasswordReset: typeof rawAuthClient.requestPasswordReset;
  resetPassword: typeof rawAuthClient.resetPassword;
  sendVerificationEmail: typeof rawAuthClient.sendVerificationEmail;
  signIn: typeof rawAuthClient.signIn;
  signOut: typeof rawAuthClient.signOut;
  signUp: typeof rawAuthClient.signUp;
  updateUser: typeof rawAuthClient.updateUser;
  useSession: typeof rawAuthClient.useSession;
  admin: Pick<typeof rawAuthClient.admin, 'impersonateUser' | 'stopImpersonating'>;
  organization: Pick<
    typeof rawAuthClient.organization,
    'acceptInvitation' | 'listUserInvitations' | 'rejectInvitation' | 'setActive'
  >;
  passkey: Pick<typeof rawAuthClient.passkey, 'addPasskey' | 'deletePasskey'>;
  twoFactor: Pick<
    typeof rawAuthClient.twoFactor,
    'disable' | 'enable' | 'verifyBackupCode' | 'verifyTotp'
  >;
};

const typedAuthClient: AppAuthClient = rawAuthClient;

// Better Auth's current client typings in this stack do not safely accept
// createAuthClient<typeof auth>(). Use the documented client-side inference
// path here until the upstream client generic can map the server auth instance.
export type AuthSession = typeof typedAuthClient.$Infer.Session;
export type AuthSessionData = AuthSession['session'];
export type AuthSessionUser = AuthSession['user'];

const rawAuthHooks = createAuthHooks(rawAuthClient);

type AppAuthHooks = Pick<
  typeof rawAuthHooks,
  | 'useActiveOrganization'
  | 'useAuthQuery'
  | 'useInvitation'
  | 'useListAccounts'
  | 'useListOrganizations'
  | 'useListPasskeys'
>;

export const authHooks: AppAuthHooks = rawAuthHooks;
export const authProviderClient = rawAuthClient;

const authTransitionListeners = new Set<() => void>();
let isSigningOut = false;

function emitAuthTransition() {
  for (const listener of authTransitionListeners) {
    listener();
  }
}

function setSigningOut(nextValue: boolean) {
  if (isSigningOut === nextValue) {
    return;
  }

  isSigningOut = nextValue;
  emitAuthTransition();
}

export function useIsSigningOut() {
  return useSyncExternalStore(
    (listener) => {
      authTransitionListeners.add(listener);
      return () => {
        authTransitionListeners.delete(listener);
      };
    },
    () => isSigningOut,
    () => false,
  );
}

export function clearSigningOutState() {
  setSigningOut(false);
}

export const authClient = typedAuthClient;

export const { signIn, useSession } = authClient;

export async function signOut(...args: Parameters<typeof authClient.signOut>) {
  setSigningOut(true);

  try {
    return await authClient.signOut(...args);
  } catch (error) {
    setSigningOut(false);
    throw error;
  }
}
