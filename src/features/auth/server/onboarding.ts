import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { createConvexPublicClient } from '~/lib/server/convex-admin.server';
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

export const beginAuthenticatorOnboardingServerFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    try {
      return await convexAuthReactStart.fetchAuthAction(
        api.auth.beginOnboardingAuthenticatorSetup,
        {},
      );
    } catch (error) {
      throw handleServerError(error, 'Begin authenticator onboarding');
    }
  },
);

const resolvePasswordResetEmailSchema = z.object({
  token: z.string().min(1),
});

export const resolvePasswordResetEmailServerFn = createServerFn({ method: 'POST' })
  .inputValidator(resolvePasswordResetEmailSchema)
  .handler(async ({ data }) => {
    try {
      return await createConvexPublicClient().action(api.auth.resolvePasswordResetEmail, data);
    } catch (error) {
      throw handleServerError(error, 'Resolve password reset email');
    }
  });
