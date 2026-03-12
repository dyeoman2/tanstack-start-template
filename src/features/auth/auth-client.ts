import { createAuthHooks } from '@daveyplate/better-auth-tanstack';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { adminClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [convexClient(), adminClient(), organizationClient()],
});

export const authHooks = createAuthHooks(authClient);

export const { signIn, signOut, useSession } = authClient;
