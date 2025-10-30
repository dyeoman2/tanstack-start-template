import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

const DEFAULT_USERS_QUERY = {
  page: 1,
  pageSize: 50,
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
  secondarySortBy: 'name' as const,
  secondarySortOrder: 'asc' as const,
  search: undefined as string | undefined,
  role: 'all' as const,
  cursor: undefined as string | undefined, // Add cursor for optimized pagination
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
};

export const getAdminDashboardDataServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    await requireAdmin();

    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);

    const [usersResult, statsResult] = await Promise.allSettled([
      fetchQuery(api.admin.getAllUsers, DEFAULT_USERS_QUERY),
      fetchQuery(api.admin.getSystemStats, {}),
    ]);

    if (usersResult.status === 'fulfilled' && statsResult.status === 'fulfilled') {
      return {
        status: 'success' as const,
        users: usersResult.value,
        stats: statsResult.value,
      };
    }

    return {
      status: 'partial' as const,
      users: usersResult.status === 'fulfilled' ? usersResult.value : null,
      stats: statsResult.status === 'fulfilled' ? statsResult.value : null,
      usersError:
        usersResult.status === 'rejected' ? getErrorMessage(usersResult.reason) : undefined,
      statsError:
        statsResult.status === 'rejected' ? getErrorMessage(statsResult.reason) : undefined,
    };
  } catch (error) {
    console.error('[Admin Dashboard] Failed to load data during SSR:', error);
    return {
      status: 'error' as const,
      error: getErrorMessage(error),
    };
  }
});

export type AdminDashboardLoaderData = Awaited<ReturnType<typeof getAdminDashboardDataServerFn>>;
