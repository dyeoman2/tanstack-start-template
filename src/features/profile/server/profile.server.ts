import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

export const getCurrentUserProfileServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAuth();
    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
    return await fetchQuery(api.users.getCurrentUserProfile, {});
  } catch (error) {
    console.error('[Profile] Failed to fetch profile data during SSR:', error);
    return null;
  }
});

export type ProfileLoaderData = Awaited<ReturnType<typeof getCurrentUserProfileServerFn>>;
