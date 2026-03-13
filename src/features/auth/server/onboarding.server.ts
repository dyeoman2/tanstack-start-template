import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { handleServerError } from '~/lib/server/error-utils.server';

export const markCurrentUserOnboardingCompleteServerFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    try {
      await requireAuth();
      return await convexAuthReactStart.fetchAuthMutation(
        api.users.markCurrentUserOnboardingComplete,
        {},
      );
    } catch (error) {
      throw handleServerError(error, 'Mark onboarding complete');
    }
  },
);
