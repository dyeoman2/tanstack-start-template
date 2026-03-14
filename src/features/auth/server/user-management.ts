import { api, internal } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';
import { handleServerError } from '~/lib/server/error-utils.server';
import { convexAuthReactStart } from './convex-better-auth-react-start';
import { USER_ROLES } from '../types';

// Zod schemas for user management
const bootstrapSignedUpUserSchema = z.object({
  authUserId: z.string().min(1, 'Auth user id is required'),
  email: z.string().email('Valid email is required'),
});

export const bootstrapSignedUpUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(bootstrapSignedUpUserSchema)
  .handler(async ({ data }) => {
    try {
      const userCountResult = await convexAuthReactStart.fetchAuthQuery(api.users.getUserCount, {});
      const isFirstUser = userCountResult.totalUsers === 1;

      const roleToSet = isFirstUser ? USER_ROLES.ADMIN : USER_ROLES.USER;
      const bootstrapResult = await createConvexAdminClient().action(
        internal.users.bootstrapUserContext,
        {
          authUserId: data.authUserId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          role: roleToSet,
        },
      );

      if (!bootstrapResult.found) {
        return {
          success: false,
          isFirstUser: false,
          message: 'Account created. Check your inbox for a verification email.',
        };
      }

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
          authUserId: data.authUserId,
          email: data.email,
        });
      } catch {
        // Preserve the original bootstrap error; rollback is best-effort.
      }

      throw handleServerError(error, 'Bootstrap signed up user');
    }
  });
