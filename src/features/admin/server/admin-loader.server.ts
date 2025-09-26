import { getAllUsersServerFn, getSystemStatsServerFn } from '~/features/dashboard/admin.server';
import type { AdminLoaderData, SystemStats, User } from '~/types/admin';

export async function loadAdminData(): Promise<AdminLoaderData> {
  const [usersResult, statsResult] = await Promise.allSettled([
    getAllUsersServerFn(),
    getSystemStatsServerFn(),
  ]);

  const errors: string[] = [];
  const users = usersResult.status === 'fulfilled' ? usersResult.value : undefined;
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
