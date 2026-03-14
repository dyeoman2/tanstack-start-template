import { randomBytes } from 'node:crypto';
import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import {
  shapeAdminUsers,
  type AdminUserSearchParams,
} from '~/features/admin/lib/admin-user-shaping';
import { normalizeUserRole } from '~/features/auth/lib/user-role';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import type { UserRole } from '~/features/auth/types';
import { USER_ROLES } from '~/features/auth/types';
import type { OnboardingStatus } from '~/lib/shared/onboarding';
import { handleServerError, ServerError } from '~/lib/server/error-utils.server';

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

const sessionTokenSchema = z.object({
  sessionToken: z.string().min(1),
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

type RawAdminUser = {
  id?: string;
  _id?: string;
  name?: string | null;
  email: string;
  emailVerified?: boolean;
  role?: string | string[];
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: string | number | Date | null;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
};

type RawAdminSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: string | number | Date;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatedBy?: string;
};

type AdminListUsersResponse = {
  users: RawAdminUser[];
  total: number;
  limit?: number;
  offset?: number;
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

export type AdminUserSession = {
  id: string;
  token: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatedBy?: string;
};

function getCurrentRequest(): Request {
  const request = getRequest();
  if (!request) {
    throw new Error('Better Auth admin utilities must run on the server');
  }

  return request;
}

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

export function normalizeAdminUser(user: RawAdminUser): AdminUser {
  const id = user.id ?? user._id;
  if (!id) {
    throw new Error('Admin user is missing an id');
  }

  return {
    id,
    email: user.email,
    name: user.name ?? null,
    role: normalizeUserRole(user.role),
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

function normalizeAdminSession(session: RawAdminSession): AdminUserSession {
  return {
    id: session.id,
    token: session.token,
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

async function readResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function callBetterAuthEndpoint<TResponse>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<TResponse> {
  const request = getCurrentRequest();
  const url = new URL(path, request.url);

  if (init.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = new Headers();
  const forwardedHeaderNames = [
    'cookie',
    'origin',
    'referer',
    'user-agent',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-real-ip',
  ] as const;

  for (const headerName of forwardedHeaderNames) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  headers.set('accept', 'application/json');

  let body: string | undefined;
  if (init.body) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }

  const response = await fetch(url, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const code =
      typeof errorPayload.code === 'string'
        ? errorPayload.code
        : typeof errorPayload.error === 'string'
          ? errorPayload.error
          : undefined;
    const message =
      typeof errorPayload.message === 'string'
        ? errorPayload.message
        : typeof payload === 'string'
          ? payload
          : undefined;

    throw new ServerError(
      normalizeAuthErrorMessage(code, message, response.status),
      response.status,
      payload,
    );
  }

  return payload as TResponse;
}

async function listAllAdminUsers(): Promise<AdminUser[]> {
  const limit = 100;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const users: AdminUser[] = [];

  while (offset < total) {
    const response = await callBetterAuthEndpoint<AdminListUsersResponse>(
      '/api/auth/admin/list-users',
      {
        query: {
          limit,
          offset,
        },
      },
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
    const response = await callBetterAuthEndpoint<RawAdminUser>('/api/auth/admin/get-user', {
      query: { id: userId },
    });

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
  const request = getCurrentRequest();
  const redirectTo = new URL('/reset-password', request.url).toString();

  await callBetterAuthEndpoint<{ status: boolean; message: string }>(
    '/api/auth/request-password-reset',
    {
      method: 'POST',
      body: {
        email,
        redirectTo,
      },
    },
  );
}

async function updateAdminUserOnboardingState(
  userId: string,
  state: {
    onboardingStatus?: OnboardingStatus;
    onboardingEmailLastSentAt?: number;
    onboardingDeliveryError?: string | null;
  },
) {
  await convexAuthReactStart.fetchAuthMutation(api.admin.setUserOnboardingStatus, {
    userId,
    onboardingStatus: state.onboardingStatus,
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
      const created = await callBetterAuthEndpoint<{ user: RawAdminUser }>('/api/auth/admin/create-user', {
        method: 'POST',
        body: {
          name,
          email,
          role: data.role,
          password,
        },
      });

      const createdUserId = created.user.id ?? created.user._id;
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
          callBetterAuthEndpoint<RawAdminUser>('/api/auth/admin/update-user', {
            method: 'POST',
            body: {
              userId: data.userId,
              data: updateData,
            },
          }),
        );
      }

      if (data.role !== undefined) {
        operations.push(
          callBetterAuthEndpoint<{ user: RawAdminUser }>('/api/auth/admin/set-role', {
            method: 'POST',
            body: {
              userId: data.userId,
              role: data.role,
            },
          }),
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
      const response = await callBetterAuthEndpoint<{ user: RawAdminUser }>(
        '/api/auth/admin/ban-user',
        {
          method: 'POST',
          body: data,
        },
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
      const response = await callBetterAuthEndpoint<{ user: RawAdminUser }>(
        '/api/auth/admin/unban-user',
        {
          method: 'POST',
          body: data,
        },
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
      const response = await callBetterAuthEndpoint<{ sessions: RawAdminSession[] }>(
        '/api/auth/admin/list-user-sessions',
        {
          method: 'POST',
          body: data,
        },
      );

      return response.sessions.map(normalizeAdminSession);
    } catch (error) {
      throw handleServerError(error, 'List admin user sessions');
    }
  });

export const revokeAdminUserSessionServerFn = createServerFn({ method: 'POST' })
  .inputValidator(sessionTokenSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      return await callBetterAuthEndpoint<{ success: boolean }>(
        '/api/auth/admin/revoke-user-session',
        {
          method: 'POST',
          body: data,
        },
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
      return await callBetterAuthEndpoint<{ success: boolean }>(
        '/api/auth/admin/revoke-user-sessions',
        {
          method: 'POST',
          body: data,
        },
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
      return await callBetterAuthEndpoint<{ status: boolean }>('/api/auth/admin/set-user-password', {
        method: 'POST',
        body: data,
      });
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

      const result = await callBetterAuthEndpoint<{ success: boolean }>(
        '/api/auth/admin/remove-user',
        {
          method: 'POST',
          body: data,
        },
      );

      try {
        await convexAuthReactStart.fetchAuthMutation(api.admin.cleanupDeletedUserData, {
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
