import { createServerFn } from '@tanstack/react-start';
import { count, desc, eq, sql } from 'drizzle-orm';
import * as schema from '~/db/schema';
import { getDb } from '~/lib/server/db-config.server';

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
  type: 'signup' | 'login' | 'purchase';
  userEmail: string;
  description: string;
  timestamp: string;
}

// Discriminated union for safe DashboardData handling
export type DashboardData =
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
  | {
      status: 'error';
      errors: string[];
    };

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
      let stats: DashboardStats | undefined;
      let activity: RecentActivity[] | undefined;

      // Process stats results
      if (statsResult.status === 'fulfilled') {
        const [totalUsersResult, activeUsersResult, recentSignupsResult] = statsResult.value;
        const totalUsers = Number(totalUsersResult[0]?.count ?? 0);
        const activeUsers = Number(activeUsersResult[0]?.count ?? 0);
        const recentSignups = Number(recentSignupsResult[0]?.count ?? 0);
        stats = {
          totalUsers,
          activeUsers,
          recentSignups,
          lastUpdated: new Date().toISOString() as IsoDateString,
        };
      } else {
        errors.push(`Failed to load stats: ${formatSettledReason(statsResult.reason)}`);
      }

      // Process activity results
      if (activityResult.status === 'fulfilled') {
        activity = activityResult.value.map((log) => ({
          id: log.id,
          type: mapAuditActionToActivityType(log.action),
          userEmail: log.userEmail,
          description: formatActivityDescription(log.action, log.entityType),
          timestamp: log.createdAt.toISOString(),
        }));
      } else {
        errors.push(`Failed to load activity: ${formatSettledReason(activityResult.reason)}`);
      }

      // Return discriminated union based on success/failure state
      if (stats && activity && errors.length === 0) {
        return {
          status: 'success',
          stats,
          activity,
        };
      } else if (errors.length > 0) {
        return {
          status: 'partial',
          stats,
          activity,
          errors,
        };
      } else {
        return {
          status: 'error',
          errors,
        };
      }
    } catch (error) {
      return {
        status: 'error',
        errors: [`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  },
);

function formatSettledReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object') {
    const { message } = reason as { message?: unknown };
    if (typeof message === 'string') return message;
    try {
      const serialized = JSON.stringify(reason);
      if (serialized && serialized !== '{}' && serialized !== '[]') {
        return serialized;
      }
    } catch {
      // noop - fall through to default return
    }
  }
  return 'Unknown error';
}

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
