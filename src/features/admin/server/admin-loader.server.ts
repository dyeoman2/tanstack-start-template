import { getAllUsersServerFn, getSystemStatsServerFn } from '~/features/dashboard/admin.server';

// Inferred types from server functions
export type User = Awaited<ReturnType<typeof getAllUsersServerFn>>['users'][number];
export type SystemStats = Awaited<ReturnType<typeof getSystemStatsServerFn>>;
export type AdminLoaderData =
  | { status: 'success'; users: User[]; stats: SystemStats }
  | { status: 'partial'; users?: User[]; stats?: SystemStats; errors: string[] }
  | { status: 'error'; errors: string[] };

export async function loadAdminData(): Promise<AdminLoaderData> {
  const [usersResult, statsResult] = await Promise.allSettled([
    getAllUsersServerFn({
      data: { page: 1, pageSize: 50, sortBy: 'createdAt', sortOrder: 'desc' },
    }),
    getSystemStatsServerFn(),
  ]);

  const errors: string[] = [];
  const usersData = usersResult.status === 'fulfilled' ? usersResult.value : undefined;
  const users = usersData?.users;
  const stats = statsResult.status === 'fulfilled' ? statsResult.value : undefined;

  if (usersResult.status === 'rejected') errors.push('Failed to load users');
  if (statsResult.status === 'rejected') errors.push('Failed to load system stats');

  if (errors.length === 0) {
    return { status: 'success', users: users as User[], stats: stats as SystemStats };
  } else if (users || stats) {
    return { status: 'partial', users, stats, errors };
  } else {
    return { status: 'error', errors };
  }
}
