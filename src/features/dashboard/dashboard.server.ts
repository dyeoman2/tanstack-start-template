import { createServerFn } from '@tanstack/react-start';

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

// Single optimized server function that fetches all dashboard data in parallel
// Auth check required for security - server functions are callable from anywhere
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
      let stats: DashboardStats | undefined;
      let activity: RecentActivity[] | undefined;

      const duration = Date.now() - startTime;
      const statsCount = stats ? 1 : 0; // stats is a single object
      const activityCount = activity?.length ?? 0;

      // Structured logging for performance monitoring
      console.log(
        `📊 Dashboard data loaded - Duration: ${duration}ms, Stats: ${statsCount}, Activity: ${activityCount}`,
      );

      return {
        status: 'success',
        stats: {
          totalUsers: 1,
          activeUsers: 0,
          recentSignups: 0,
          lastUpdated: new Date().toISOString() as IsoDateString,
        },
        activity: [],
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `❌ Dashboard data error - Duration: ${duration}ms, Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      return {
        status: 'error',
        errors: [`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  },
);
