import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

export const getCurrentUserProfileServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    // ✅ No auth check needed - route guard already validated user is authenticated
    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
    return await fetchQuery(api.users.getCurrentUserProfile, {});
  } catch (error) {
    console.error('[Profile] Failed to fetch profile data during SSR:', error);
    return null;
  }
});

export type ProfileLoaderData = Awaited<ReturnType<typeof getCurrentUserProfileServerFn>>;
