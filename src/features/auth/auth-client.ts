import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthHooks } from '@daveyplate/better-auth-tanstack';
import {
  adminClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { useSyncExternalStore } from 'react';
import type { getOptions } from '../../../convex/betterAuth/options';
import {
  adminAccessControl,
  adminRole,
  organizationAccessControl,
  organizationAdminRole,
  organizationMemberRole,
  organizationOwnerRole,
  userRole,
} from '~/lib/shared/better-auth-access';

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

export const authClient = createAuthClient({
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

// Better Auth's current client typings in this stack do not safely accept
// createAuthClient<typeof auth>(). Use the documented client-side inference
// path here until the upstream client generic can map the server auth instance.
export type AuthSession = typeof authClient.$Infer.Session;
export type AuthSessionData = AuthSession['session'];
export type AuthSessionUser = AuthSession['user'];

export const authHooks = createAuthHooks(authClient);

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
