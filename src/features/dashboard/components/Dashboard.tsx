import { PageHeader } from '~/components/PageHeader';
import { api } from '../../../../convex/_generated/api';
import { useLoaderSeededQuery } from '../hooks/useLoaderSeededQuery';
import type { DashboardLoaderData } from '../server/dashboard.server';
import { MetricCard, SkeletonCard } from './MetricCard';
import { RecentActivity } from './RecentActivity';

type DashboardProps = {
  initialData: DashboardLoaderData;
};

export function Dashboard({ initialData }: DashboardProps) {
  const { data: dashboardData, isLivePending } = useLoaderSeededQuery(
    api.dashboard.getDashboardData,
    {},
    initialData,
  );

  const hasInitialData = initialData !== null;
  const isLoading = !hasInitialData && (isLivePending || dashboardData === null);
  const hasErrors = !isLoading && dashboardData === null;

  // Extract data
  const stats = dashboardData?.stats;
  const activity = dashboardData?.activity || [];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description={
            <>
              TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI,
              Resend, and deployed to Netlify.
            </>
          }
        />

        {/* Loading Metrics Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <SkeletonCard title="Total Users" />
          <SkeletonCard title="Active Users" />
          <SkeletonCard title="Recent Signups" />
        </div>

        {/* Loading Recent Activity */}
        <div className="bg-card rounded-lg border border-border p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-muted rounded w-48 mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={`skeleton-${item}`} className="flex items-center space-x-4">
                  <div className="h-10 w-10 bg-muted rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <>
            TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI, Resend,
            and deployed to Netlify.
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
                Failed to load dashboard data
              </h3>
              <div className="mt-2 text-sm text-secondary-foreground">
                Please try refreshing the page.
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
