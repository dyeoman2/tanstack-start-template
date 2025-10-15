import { PageHeader } from '~/components/PageHeader';
import type { DashboardData } from '~/features/dashboard/dashboard.server';
import { MetricCard, SkeletonCard } from './MetricCard';
import { RecentActivity } from './RecentActivity';

interface DashboardProps {
  data: DashboardData;
}

export function Dashboard({ data }: DashboardProps) {
  // Extract data based on discriminated union status
  const stats = data.status === 'success' || data.status === 'partial' ? data.stats : undefined;
  const activity = data.status === 'success' || data.status === 'partial' ? data.activity : [];
  const errors = data.status === 'error' || data.status === 'partial' ? data.errors : [];
  const hasErrors = errors.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <>
            TanStack Start Template built with Better Auth, Drizzle, Tailwind CSS, Shadcn/UI,
            Resend, Neon Postgres, and deployed to Netlify.
          </>
        }
      />

      {/* Error Alert */}
      {hasErrors && (
        <div className="bg-muted border border-border rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-muted-foreground"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-secondary-foreground">
                Some data failed to load
              </h3>
              <div className="mt-2 text-sm text-secondary-foreground">
                <ul className="list-disc pl-5 space-y-1">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {stats ? (
          <MetricCard title="Total Users" value={stats.totalUsers.toLocaleString()} />
        ) : (
          <SkeletonCard title="Total Users" />
        )}

        {stats ? (
          <MetricCard title="Active Users" value={stats.activeUsers.toString()} />
        ) : (
          <SkeletonCard title="Active Users" />
        )}

        {/* New User Button */}
        {stats ? (
          <MetricCard title="Recent Signups" value={stats.recentSignups.toString()} />
        ) : (
          <SkeletonCard title="Recent Signups" />
        )}
      </div>

      {/* Recent Activity */}
      <RecentActivity activities={activity || []} />
    </div>
  );
}
