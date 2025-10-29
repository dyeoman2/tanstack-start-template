import { createServerFn } from '@tanstack/react-start';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { handleServerError } from '~/lib/server/error-utils.server';

// Note: Convex imports are handled by setupFetchClient, no direct imports needed

type IsoDateString = string & { __brand: 'IsoDateString' };

// Dashboard data interfaces with proper typing
export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  recentSignups: number;
  lastUpdated: IsoDateString;
}

export interface RecentActivity {
  id: string;
  type: 'signup' | 'login' | 'purchase' | 'unknown';
  userEmail: string;
  description: string;
  timestamp: IsoDateString;
}

// Discriminated union for safe DashboardData handling
export type DashboardData = Awaited<ReturnType<typeof getDashboardDataServerFn>>;

// Single optimized server function that fetches all dashboard data in parallel - migrated to Convex
export const getDashboardDataServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<
    | {
        status: 'success';
        stats: DashboardStats;
        activity: RecentActivity[];
      }
    | {
        status: 'partial';
        stats?: DashboardStats;
        activity?: RecentActivity[];
        errors: string[];
      }
    | { status: 'error'; errors: string[] }
  > => {
    const startTime = Date.now();

    try {
      await requireAdmin();

      // For now, return placeholder dashboard data
      // TODO: Implement proper Convex integration for dashboard
      const dashboardData = {
        status: 'success' as const,
        stats: {
          totalUsers: 1,
          activeUsers: 1,
          recentSignups: 0,
          lastUpdated: new Date().toISOString() as IsoDateString,
        },
        activity: [],
      };

      const duration = Date.now() - startTime;
      const statsCount = 1; // stats is a single object
      const activityCount = dashboardData.activity?.length ?? 0;

      // Structured logging for performance monitoring
      console.log(
        `📊 Dashboard data loaded - Duration: ${duration}ms, Stats: ${statsCount}, Activity: ${activityCount}`,
      );

      return dashboardData;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `❌ Dashboard data error - Duration: ${duration}ms, Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      throw handleServerError(error, 'Get dashboard data');
    }
  },
);
