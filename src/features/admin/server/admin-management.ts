import { randomBytes } from 'node:crypto';
import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  type AdminUserSearchParams,
  shapeAdminUsers,
} from '~/features/admin/lib/admin-user-shaping';
import { normalizeUserRole } from '~/features/auth/lib/user-role';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import type { UserRole } from '~/features/auth/types';
import { USER_ROLES } from '~/features/auth/types';
import {
  type BetterAuthAdminListUsersResult,
  type BetterAuthAdminUser,
  type BetterAuthAdminUserSession,
  banBetterAuthUser,
  createBetterAuthUser,
  getBetterAuthUser,
  listBetterAuthUserSessions,
  listBetterAuthUsers,
  removeBetterAuthUser,
  requestBetterAuthPasswordReset,
  revokeBetterAuthUserSession,
  revokeBetterAuthUserSessions,
  setBetterAuthUserPassword,
  setBetterAuthUserRole,
  unbanBetterAuthUser,
  updateBetterAuthUser,
} from '~/lib/server/better-auth/api';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { handleServerError, ServerError } from '~/lib/server/error-utils.server';
import type { OnboardingStatus } from '~/lib/shared/onboarding';

const userSearchSchema = z.object({
  page: z.number().min(1),
  pageSize: z.number().min(1),
  sortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']),
  sortOrder: z.enum(['asc', 'desc']),
  secondarySortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']),
  secondarySortOrder: z.enum(['asc', 'desc']),
  search: z.string(),
  role: z.enum(['all', USER_ROLES.ADMIN, USER_ROLES.USER]),
  cursor: z.string().optional(),
});

const userIdSchema = z.object({
  userId: z.string().min(1),
});

const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().optional(),
  role: z.enum([USER_ROLES.ADMIN, USER_ROLES.USER]).optional(),
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum([USER_ROLES.ADMIN, USER_ROLES.USER]),
});

const banUserSchema = z.object({
  userId: z.string().min(1),
  banReason: z.string().optional(),
  banExpiresIn: z.number().int().positive().optional(),
});

const setPasswordSchema = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(8),
});

const sessionIdSchema = z.object({
  sessionId: z.string().min(1),
});

type CreateAdminUserResult = {
  onboardingEmailSent: boolean;
  onboardingErrorMessage?: string;
  user: AdminUser;
};

type SendAdminOnboardingEmailResult = {
  success: boolean;
  onboardingStatus: OnboardingStatus;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  onboardingStatus: OnboardingStatus;
  onboardingEmailId?: string;
  onboardingEmailMessageId?: string;
  onboardingEmailLastSentAt?: number;
  onboardingCompletedAt?: number;
  onboardingDeliveryUpdatedAt?: number;
  onboardingDeliveryError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AdminUserSession = BetterAuthAdminUserSession;

function toTimestamp(value: string | number | Date | undefined | null): number {
  if (!value) {
    return Date.now();
  }

  if (typeof value === 'number') {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

export function normalizeAdminUser(user: BetterAuthAdminUser): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: normalizeUserRole(user.role ?? undefined),
    emailVerified: user.emailVerified ?? false,
    banned: user.banned === true,
    banReason: user.banReason ?? null,
    banExpires: user.banExpires ? toTimestamp(user.banExpires) : null,
    onboardingStatus: 'not_started',
    onboardingEmailId: undefined,
    onboardingEmailMessageId: undefined,
    onboardingEmailLastSentAt: undefined,
    onboardingCompletedAt: undefined,
    onboardingDeliveryUpdatedAt: undefined,
    onboardingDeliveryError: null,
    createdAt: toTimestamp(user.createdAt),
    updatedAt: toTimestamp(user.updatedAt),
  };
}

function normalizeAdminSession(session: BetterAuthAdminUserSession): AdminUserSession {
  return {
    id: session.id,
    userId: session.userId,
    expiresAt: toTimestamp(session.expiresAt),
    createdAt: toTimestamp(session.createdAt),
    updatedAt: toTimestamp(session.updatedAt),
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
    impersonatedBy: session.impersonatedBy,
  };
}

export { shapeAdminUsers };

function normalizeAuthErrorMessage(
  code: string | undefined,
  message: string | undefined,
  status: number,
) {
  if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return 'User already exists. Please use a different email.';
  }

  if (code === 'YOU_CANNOT_REMOVE_YOURSELF') {
    return 'Cannot delete your own account';
  }

  if (code === 'YOU_CANNOT_BAN_YOURSELF') {
    return 'Cannot ban your own account';
  }

  if (code === 'YOU_CANNOT_IMPERSONATE_ADMINS') {
    return 'Cannot impersonate another admin';
  }

  if (status === 404) {
    return 'User not found';
  }

  return message || 'Admin action failed';
}

async function listAllAdminUsers(): Promise<AdminUser[]> {
  const limit = 100;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const users: AdminUser[] = [];

  while (offset < total) {
    const response: BetterAuthAdminListUsersResult = await listBetterAuthUsers(
      {
        limit,
        offset,
      },
      ({ code, message, status }) => normalizeAuthErrorMessage(code ?? undefined, message, status),
    );

    const page = response.users.map(normalizeAdminUser);
    users.push(...page);
    total = response.total;
    offset += page.length;

    if (page.length === 0) {
      break;
    }
  }

  return users;
}

async function getAdminUserById(userId: string): Promise<AdminUser | null> {
  try {
    const response = await getBetterAuthUser(userId, ({ code, message, status }) =>
      normalizeAuthErrorMessage(code ?? undefined, message, status),
    );

    return normalizeAdminUser(response);
  } catch (error) {
    if (error instanceof ServerError && error.code === 404) {
      return null;
    }

    throw error;
  }
}

function assertCanDeleteUser(users: AdminUser[], currentUserId: string, targetUserId: string) {
  if (targetUserId === currentUserId) {
    throw new ServerError('Cannot delete your own account', 400);
  }

  const target = users.find((user) => user.id === targetUserId);
  if (!target) {
    throw new ServerError('User not found', 404);
  }

  if (target.role === USER_ROLES.ADMIN) {
    const adminCount = users.filter((user) => user.role === USER_ROLES.ADMIN).length;
    if (adminCount <= 1) {
      throw new ServerError('Cannot delete the only site admin', 400);
    }
  }

  return target;
}

function assertCanSetRole(
  users: AdminUser[],
  currentUserId: string,
  targetUserId: string,
  role: UserRole,
) {
  if (targetUserId !== currentUserId || role === USER_ROLES.ADMIN) {
    return;
  }

  const adminCount = users.filter((user) => user.role === USER_ROLES.ADMIN).length;
  if (adminCount <= 1) {
    throw new ServerError('At least one site admin must remain', 400);
  }
}

export const listAdminUsersServerFn = createServerFn({ method: 'GET' })
  .inputValidator(userSearchSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      await convexAuthReactStart.fetchAuthAction(api.admin.ensureUserIndex, {});
      return await convexAuthReactStart.fetchAuthQuery(
        api.admin.listUsers,
        data as AdminUserSearchParams,
      );
    } catch (error) {
      throw handleServerError(error, 'List admin users');
    }
  });

function createOnboardingPassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

async function requestOnboardingEmail(email: string) {
  const request = getBetterAuthRequest();
  const redirectTo = new URL('/reset-password', request.url).toString();

  await requestBetterAuthPasswordReset(
    {
      email,
      redirectTo,
    },
    ({ code, message, status }) => normalizeAuthErrorMessage(code ?? undefined, message, status),
  );
}

async function updateAdminUserOnboardingState(
  userId: string,
  state: {
    onboardingStatus?: OnboardingStatus;
    onboardingEmailId?: string | null;
    onboardingEmailMessageId?: string | null;
    onboardingEmailLastSentAt?: number;
    onboardingDeliveryError?: string | null;
  },
) {
  await convexAuthReactStart.fetchAuthMutation(api.admin.setUserOnboardingStatus, {
    userId,
    onboardingStatus: state.onboardingStatus,
    onboardingEmailId: state.onboardingEmailId,
    onboardingEmailMessageId: state.onboardingEmailMessageId,
    onboardingEmailLastSentAt: state.onboardingEmailLastSentAt,
    onboardingDeliveryError: state.onboardingDeliveryError,
  });
}

export const createAdminUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(createUserSchema)
  .handler(async ({ data }): Promise<CreateAdminUserResult> => {
    try {
      await requireAdmin();

      const emailServiceStatus = await convexAuthReactStart.fetchAuthQuery(
        api.emails.checkEmailServiceConfigured,
        {},
      );
      if (!emailServiceStatus.isConfigured) {
        throw new ServerError(
          'Email service is not configured. Admin-created employees require onboarding email delivery.',
          400,
        );
      }

      const name = data.name.trim();
      const email = data.email.trim().toLowerCase();
      const password = createOnboardingPassword();
      const created = await createBetterAuthUser(
        {
          name,
          email,
          role: data.role,
          password,
        },
        ({ code, message, status }) =>
          normalizeAuthErrorMessage(code ?? undefined, message, status),
      );

      const createdUserId = created.user.id;
      if (!createdUserId) {
        throw new Error('Created user is missing an id');
      }

      await convexAuthReactStart.fetchAuthMutation(api.admin.syncUserIndexEntry, {
        userId: createdUserId,
      });
      try {
        await requestOnboardingEmail(email);
        const onboardingEmailLastSentAt = Date.now();
        await updateAdminUserOnboardingState(createdUserId, {
          onboardingStatus: 'email_sent',
          onboardingEmailId: null,
          onboardingEmailMessageId: null,
          onboardingEmailLastSentAt,
          onboardingDeliveryError: null,
        });

        return {
          user: {
            ...normalizeAdminUser(created.user),
            onboardingStatus: 'email_sent',
            onboardingEmailLastSentAt,
            onboardingDeliveryError: null,
          },
          onboardingEmailSent: true,
        };
      } catch (emailError) {
        await updateAdminUserOnboardingState(createdUserId, {
          onboardingStatus: 'email_pending',
          onboardingEmailId: null,
          onboardingEmailMessageId: null,
          onboardingDeliveryError:
            emailError instanceof Error
              ? emailError.message
              : 'User created, but sending the onboarding email failed.',
        });

        return {
          user: {
            ...normalizeAdminUser(created.user),
            onboardingStatus: 'email_pending',
            onboardingDeliveryError:
              emailError instanceof Error
                ? emailError.message
                : 'User created, but sending the onboarding email failed.',
          },
          onboardingEmailSent: false,
          onboardingErrorMessage:
            emailError instanceof Error
              ? emailError.message
              : 'User created, but sending the onboarding email failed.',
        };
      }
    } catch (error) {
      throw handleServerError(error, 'Create admin user');
    }
  });

export const sendAdminUserOnboardingEmailServerFn = createServerFn({ method: 'POST' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }): Promise<SendAdminOnboardingEmailResult> => {
    try {
      await requireAdmin();
      const user = await getAdminUserById(data.userId);
      if (!user) {
        throw new ServerError('User not found', 404);
      }

      await requestOnboardingEmail(user.email);
      await updateAdminUserOnboardingState(data.userId, {
        onboardingStatus: 'email_sent',
        onboardingEmailId: null,
        onboardingEmailMessageId: null,
        onboardingEmailLastSentAt: Date.now(),
        onboardingDeliveryError: null,
      });

      return { success: true, onboardingStatus: 'email_sent' };
    } catch (error) {
      try {
        const user = await getAdminUserById(data.userId);
        if (user && user.onboardingStatus !== 'completed') {
          await updateAdminUserOnboardingState(data.userId, {
            onboardingStatus: user.onboardingStatus,
            onboardingEmailId: null,
            onboardingEmailMessageId: null,
            onboardingDeliveryError:
              error instanceof Error ? error.message : 'Failed to send onboarding email',
          });
        }
      } catch {
        // Preserve the original server error if the follow-up state update also fails.
      }

      throw handleServerError(error, 'Send admin onboarding email');
    }
  });

export const updateAdminUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(updateUserSchema)
  .handler(async ({ data }) => {
    try {
      const { user: currentUser } = await requireAdmin();
      const updateData: Record<string, unknown> = {};

      if (data.name !== undefined) {
        updateData.name = data.name.trim();
      }

      if (data.email !== undefined) {
        updateData.email = data.email.trim().toLowerCase();
      }

      if (data.phoneNumber !== undefined) {
        updateData.phoneNumber = data.phoneNumber || null;
      }

      if (data.role !== undefined) {
        const users = await listAllAdminUsers();
        assertCanSetRole(users, currentUser.id, data.userId, data.role);
      }

      const operations: Array<Promise<unknown>> = [];

      if (Object.keys(updateData).length > 0) {
        operations.push(
          updateBetterAuthUser(
            {
              userId: data.userId,
              data: updateData,
            },
            ({ code, message, status }) =>
              normalizeAuthErrorMessage(code ?? undefined, message, status),
          ),
        );
      }

      if (data.role !== undefined) {
        operations.push(
          setBetterAuthUserRole(
            {
              userId: data.userId,
              role: data.role,
            },
            ({ code, message, status }) =>
              normalizeAuthErrorMessage(code ?? undefined, message, status),
          ),
        );
      }

      await Promise.all(operations);
      await convexAuthReactStart.fetchAuthMutation(api.admin.syncUserIndexEntry, {
        userId: data.userId,
      });

      return await getAdminUserById(data.userId);
    } catch (error) {
      throw handleServerError(error, 'Update admin user');
    }
  });

export const banAdminUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(banUserSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const response = await banBetterAuthUser(data, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );
      await convexAuthReactStart.fetchAuthMutation(api.admin.syncUserIndexEntry, {
        userId: data.userId,
      });

      return normalizeAdminUser(response.user);
    } catch (error) {
      throw handleServerError(error, 'Ban admin user');
    }
  });

export const unbanAdminUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const response = await unbanBetterAuthUser(data.userId, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );
      await convexAuthReactStart.fetchAuthMutation(api.admin.syncUserIndexEntry, {
        userId: data.userId,
      });

      return normalizeAdminUser(response.user);
    } catch (error) {
      throw handleServerError(error, 'Unban admin user');
    }
  });

export const listAdminUserSessionsServerFn = createServerFn({ method: 'POST' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      const response = await listBetterAuthUserSessions(data.userId, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );
      await convexAuthReactStart.fetchAuthAction(api.admin.recordAdminUserSessionsViewed, {
        sessionCount: response.sessions.length,
        targetUserId: data.userId,
      });

      return response.sessions.map(normalizeAdminSession);
    } catch (error) {
      throw handleServerError(error, 'List admin user sessions');
    }
  });

export const revokeAdminUserSessionServerFn = createServerFn({ method: 'POST' })
  .inputValidator(sessionIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      return await revokeBetterAuthUserSession(data.sessionId, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Revoke admin user session');
    }
  });

export const revokeAdminUserSessionsServerFn = createServerFn({ method: 'POST' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      return await revokeBetterAuthUserSessions(data.userId, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Revoke admin user sessions');
    }
  });

export const setAdminUserPasswordServerFn = createServerFn({ method: 'POST' })
  .inputValidator(setPasswordSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      return await setBetterAuthUserPassword(data, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Set admin user password');
    }
  });

export const deleteAdminUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    try {
      const { user: currentUser } = await requireAdmin();
      const users = await listAllAdminUsers();
      const target = assertCanDeleteUser(users, currentUser.id, data.userId);

      const result = await removeBetterAuthUser(data.userId, ({ code, message, status }) =>
        normalizeAuthErrorMessage(code ?? undefined, message, status),
      );

      try {
        await convexAuthReactStart.fetchAuthAction(api.admin.cleanupDeletedUserData, {
          userId: data.userId,
          email: target.email,
        });
        await convexAuthReactStart.fetchAuthMutation(api.admin.deleteUserIndexEntry, {
          userId: data.userId,
        });
      } catch (error) {
        throw new ServerError(
          'Auth user removal succeeded, but app cleanup failed. Retry the cleanup flow to reconcile remaining Convex data.',
          error instanceof ServerError ? error.code : 500,
          error,
        );
      }

      return result;
    } catch (error) {
      throw handleServerError(error, 'Delete admin user');
    }
  });
