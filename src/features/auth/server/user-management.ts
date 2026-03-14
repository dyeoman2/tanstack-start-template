import { api, internal } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';
import { handleServerError } from '~/lib/server/error-utils.server';
import { normalizeUserId } from '~/lib/shared/user-id';
import { USER_ROLES } from '../types';
import { convexAuthReactStart } from './convex-better-auth-react-start';

export const bootstrapSignedUpUserServerFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    let currentProfile: { email?: string | null } | null | undefined;

    try {
      const userCountResult = await convexAuthReactStart.fetchAuthQuery(api.users.getUserCount, {});
      const isFirstUser = userCountResult.totalUsers === 1;
      currentProfile = await convexAuthReactStart.fetchAuthQuery(
        api.users.getCurrentUserProfile,
        {},
      );
      const authUserId = normalizeUserId(currentProfile);
      const email =
        typeof currentProfile?.email === 'string' && currentProfile.email.length > 0
          ? currentProfile.email
          : null;

      if (!authUserId || !email) {
        throw new Error('Authenticated signup context is unavailable');
      }

      const roleToSet = isFirstUser ? USER_ROLES.ADMIN : USER_ROLES.USER;
      const bootstrapResult = await createConvexAdminClient().action(
        internal.users.bootstrapUserContext,
        {
          authUserId,
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
        const rollbackProfile =
          currentProfile ??
          (await convexAuthReactStart.fetchAuthQuery(api.users.getCurrentUserProfile, {}));
        await createConvexAdminClient().action(internal.users.rollbackBootstrapUserContext, {
          authUserId: normalizeUserId(rollbackProfile) ?? '',
          email: rollbackProfile?.email ?? '',
        });
      } catch {
        // Preserve the original bootstrap error; rollback is best-effort.
      }

      throw handleServerError(error, 'Bootstrap signed up user');
    }
  },
);
