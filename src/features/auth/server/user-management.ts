import { internal } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';
import { handleServerError } from '~/lib/server/error-utils.server';
import { assertUserId } from '~/lib/shared/user-id';

const bootstrapSignedUpUserSchema = z.object({
  authUserId: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export const bootstrapSignedUpUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(bootstrapSignedUpUserSchema)
  .handler(async ({ data }) => {
    const authUserId = assertUserId(data.authUserId, 'Authenticated signup context is unavailable');
    const email = data.email;

    try {
      const bootstrapResult = await createConvexAdminClient().action(
        internal.users.bootstrapUserContext,
        {
          authUserId,
          email,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
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
        await createConvexAdminClient().action(internal.users.rollbackBootstrapUserContext, {
          authUserId,
          email,
        });
      } catch {
        // Preserve the original bootstrap error; rollback is best-effort.
      }

      throw handleServerError(error, 'Bootstrap signed up user');
    }
  });
