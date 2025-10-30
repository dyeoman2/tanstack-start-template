import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { api } from '../../../../convex/_generated/api';
import { createAuth } from '../../../../convex/auth';

export const getDashboardDataServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const { fetchQuery } = await setupFetchClient(createAuth, getCookie);
    const dashboardData = await fetchQuery(api.dashboard.getDashboardData, {});
    return dashboardData;
  } catch (error) {
    console.error('[Dashboard] Failed to fetch dashboard data during SSR:', error);
    return null;
  }
});

export type DashboardLoaderData = Awaited<ReturnType<typeof getDashboardDataServerFn>>;
