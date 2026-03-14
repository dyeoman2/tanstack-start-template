import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthHooks } from '@daveyplate/better-auth-tanstack';
import { adminClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { useSyncExternalStore } from 'react';

export const authClient = createAuthClient({
  plugins: [
    convexClient(),
    adminClient(),
    // Match the server plugin configuration: organizations enabled, teams intentionally omitted.
    organizationClient(),
  ],
});

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
