import { fetchSession } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

export const getAuthStatusServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ isAuthenticated: boolean }> => {
    const request = getRequest();
    if (!request) {
      throw new Error('No request available');
    }

    const { session } = await fetchSession(request);

    return {
      isAuthenticated: Boolean(session?.user),
    };
  },
);
