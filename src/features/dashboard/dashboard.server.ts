import { createServerFn } from '@tanstack/react-start';
import { count, desc, eq, sql } from 'drizzle-orm';
import * as schema from '~/db/schema';
import { getDb } from '~/lib/server/db-config.server';

// Dashboard data interfaces with proper typing
export interface DashboardStats {
  totalUsers: number;
  activeUsers: number;
  recentSignups: number;
  lastUpdated: Date;
}

export interface RecentActivity {
  id: string;
  type: 'signup' | 'login' | 'purchase';
  userEmail: string;
  description: string;
  timestamp: string;
}

export interface DashboardData {
  stats?: DashboardStats;
  activity?: RecentActivity[];
  errors: string[];
}

// Single optimized server function that fetches all dashboard data in parallel
// No auth check needed here - route loader already verified auth via authGuard
export const getDashboardDataServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardData> => {
    const db = getDb();

    try {
      // Execute all database queries in parallel for maximum performance
      const [statsResult, activityResult] = await Promise.allSettled([
        // Get dashboard stats with optimized queries
        Promise.all([
          // Total users count
          db
            .select({ count: count() })
            .from(schema.user),
          // Active users (logged in within last 30 days)
          db
            .select({ count: count() })
            .from(schema.user)
            .where(sql`${schema.user.updatedAt} > now() - interval '30 days'`),
          // Recent signups (last 24 hours)
          db
            .select({ count: count() })
            .from(schema.user)
            .where(sql`${schema.user.createdAt} > now() - interval '24 hours'`),
        ]),
        // Get recent activity from audit log
        db
          .select({
            id: schema.auditLog.id,
            action: schema.auditLog.action,
            entityType: schema.auditLog.entityType,
            createdAt: schema.auditLog.createdAt,
            userEmail: schema.user.email,
          })
          .from(schema.auditLog)
          .innerJoin(schema.user, eq(schema.auditLog.userId, schema.user.id))
          .where(sql`${schema.auditLog.createdAt} > now() - interval '24 hours'`)
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(10),
      ]);

      const errors: string[] = [];
      const data: DashboardData = { errors };

      // Process stats results
      if (statsResult.status === 'fulfilled') {
        const [totalUsersResult, activeUsersResult, recentSignupsResult] = statsResult.value;
        const totalUsers = Number(totalUsersResult[0]?.count ?? 0);
        const activeUsers = Number(activeUsersResult[0]?.count ?? 0);
        const recentSignups = Number(recentSignupsResult[0]?.count ?? 0);
        data.stats = {
          totalUsers,
          activeUsers,
          recentSignups,
          lastUpdated: new Date(),
        };
      } else {
        errors.push(`Failed to load stats: ${statsResult.reason}`);
      }

      // Process activity results
      if (activityResult.status === 'fulfilled') {
        data.activity = activityResult.value.map((log) => ({
          id: log.id,
          type: mapAuditActionToActivityType(log.action),
          userEmail: log.userEmail,
          description: formatActivityDescription(log.action, log.entityType),
          timestamp: log.createdAt.toISOString(),
        }));
      } else {
        errors.push(`Failed to load activity: ${activityResult.reason}`);
      }

      return data;
    } catch (error) {
      return {
        errors: [`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  },
);

// Helper functions for activity mapping
function mapAuditActionToActivityType(action: string): RecentActivity['type'] {
  switch (action.toLowerCase()) {
    case 'create':
      return 'signup';
    case 'login':
      return 'login';
    case 'purchase':
    case 'payment':
      return 'purchase';
    default:
      return 'login'; // fallback
  }
}

function formatActivityDescription(action: string, entityType: string): string {
  switch (action.toLowerCase()) {
    case 'create':
      return entityType === 'user' ? 'New user registration' : `Created ${entityType}`;
    case 'login':
      return 'User login';
    case 'purchase':
      return 'Completed purchase';
    case 'payment':
      return 'Payment processed';
    default:
      return `${action} ${entityType}`;
  }
}
