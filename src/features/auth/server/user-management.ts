import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { handleServerError } from '~/lib/server/error-utils.server';

const bootstrapSignedUpUserSchema = z.object({
  authUserId: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export const bootstrapSignedUpUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(bootstrapSignedUpUserSchema)
  .handler(async () => {
    try {
      const bootstrapResult = await convexAuthReactStart.fetchAuthAction(
        api.users.bootstrapCurrentUserContext,
        {},
      );

      if (!bootstrapResult.found) {
        return {
          success: false,
          isFirstUser: false,
          message: 'Account created. Check your inbox for a verification email.',
        };
      }

      const isFirstUser = bootstrapResult.assignedRole === 'admin';

      return {
        success: true,
        isFirstUser,
        message: isFirstUser
          ? 'Admin account created. Check your inbox to verify your email.'
          : 'Account created. Check your inbox to verify your email.',
      };
    } catch (error) {
      try {
        await convexAuthReactStart.fetchAuthAction(
          api.users.rollbackCurrentUserBootstrapContext,
          {},
        );
      } catch {
        // Preserve the original bootstrap error; rollback is best-effort.
      }

      throw handleServerError(error, 'Bootstrap signed up user');
    }
  });
