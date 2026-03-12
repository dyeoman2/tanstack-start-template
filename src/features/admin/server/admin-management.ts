import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import type { UserRole } from '~/features/auth/types';
import { USER_ROLES } from '~/features/auth/types';
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

function normalizeRole(role: string | string[] | undefined): UserRole {
  if (Array.isArray(role)) {
    return role.includes(USER_ROLES.ADMIN) ? USER_ROLES.ADMIN : USER_ROLES.USER;
  }

  return role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.USER;
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
    role: normalizeRole(user.role),
    emailVerified: user.emailVerified ?? false,
    banned: user.banned === true,
    banReason: user.banReason ?? null,
    banExpires: user.banExpires ? toTimestamp(user.banExpires) : null,
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

type UserSortField = z.infer<typeof userSearchSchema>['sortBy'];
type SortDirection = z.infer<typeof userSearchSchema>['sortOrder'];

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  if (left === right) {
    return 0;
  }

  if (direction === 'asc') {
    return left > right ? 1 : -1;
  }

  return left < right ? 1 : -1;
}

function sortValue(user: AdminUser, field: UserSortField): string | number {
  switch (field) {
    case 'name':
      return user.name?.toLowerCase() ?? '';
    case 'email':
      return user.email.toLowerCase();
    case 'role':
      return user.role;
    case 'emailVerified':
      return user.emailVerified ? 1 : 0;
    default:
      return user.createdAt;
  }
}

export function shapeAdminUsers(users: AdminUser[], params: z.infer<typeof userSearchSchema>) {
  const searchValue = params.search.trim().toLowerCase();
  let filtered = users;

  if (params.role !== 'all') {
    filtered = filtered.filter((user) => user.role === params.role);
  }

  if (searchValue) {
    filtered = filtered.filter(
      (user) =>
        user.email.toLowerCase().includes(searchValue) ||
        (user.name?.toLowerCase().includes(searchValue) ?? false),
    );
  }

  filtered = [...filtered].sort((left, right) => {
    const primary = compareValues(
      sortValue(left, params.sortBy),
      sortValue(right, params.sortBy),
      params.sortOrder,
    );

    if (primary !== 0) {
      return primary;
    }

    return compareValues(
      sortValue(left, params.secondarySortBy),
      sortValue(right, params.secondarySortBy),
      params.secondarySortOrder,
    );
  });

  const total = filtered.length;
  const start = Math.max(0, (params.page - 1) * params.pageSize);
  const end = start + params.pageSize;

  return {
    users: filtered.slice(start, end),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
      hasNextPage: end < total,
      nextCursor: end < total ? String(params.page + 1) : null,
    },
  };
}

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

async function callBetterAuthAdmin<TResponse>(
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
    const response = await callBetterAuthAdmin<AdminListUsersResponse>(
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
    const response = await callBetterAuthAdmin<RawAdminUser>('/api/auth/admin/get-user', {
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
      const users = await listAllAdminUsers();
      return shapeAdminUsers(users, data);
    } catch (error) {
      throw handleServerError(error, 'List admin users');
    }
  });

export const getAdminUserServerFn = createServerFn({ method: 'GET' })
  .inputValidator(userIdSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      return await getAdminUserById(data.userId);
    } catch (error) {
      throw handleServerError(error, 'Get admin user');
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
          callBetterAuthAdmin<RawAdminUser>('/api/auth/admin/update-user', {
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
          callBetterAuthAdmin<{ user: RawAdminUser }>('/api/auth/admin/set-role', {
            method: 'POST',
            body: {
              userId: data.userId,
              role: data.role,
            },
          }),
        );
      }

      await Promise.all(operations);

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
      const response = await callBetterAuthAdmin<{ user: RawAdminUser }>(
        '/api/auth/admin/ban-user',
        {
          method: 'POST',
          body: data,
        },
      );

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
      const response = await callBetterAuthAdmin<{ user: RawAdminUser }>(
        '/api/auth/admin/unban-user',
        {
          method: 'POST',
          body: data,
        },
      );

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
      const response = await callBetterAuthAdmin<{ sessions: RawAdminSession[] }>(
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
      return await callBetterAuthAdmin<{ success: boolean }>(
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
      return await callBetterAuthAdmin<{ success: boolean }>(
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
      return await callBetterAuthAdmin<{ status: boolean }>('/api/auth/admin/set-user-password', {
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

      await convexAuthReactStart.fetchAuthMutation(api.admin.cleanupDeletedUserData, {
        userId: data.userId,
        email: target.email,
      });

      try {
        return await callBetterAuthAdmin<{ success: boolean }>('/api/auth/admin/remove-user', {
          method: 'POST',
          body: data,
        });
      } catch (error) {
        throw new ServerError(
          'App cleanup completed, but removing the auth user failed. Manual reconciliation is required.',
          error instanceof ServerError ? error.code : 500,
          error,
        );
      }
    } catch (error) {
      throw handleServerError(error, 'Delete admin user');
    }
  });
