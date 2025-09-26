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

  const activeUserPercentage =
    stats && stats.totalUsers > 0
      ? ((stats.activeUsers / stats.totalUsers) * 100).toFixed(1)
      : null;

  return (
    <div className="px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      </div>

      {/* Error Alert */}
      {hasErrors && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
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
              <h3 className="text-sm font-medium text-yellow-800">Some data failed to load</h3>
              <div className="mt-2 text-sm text-yellow-700">
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
          <MetricCard
            title="Total Users"
            value={stats.totalUsers.toLocaleString()}
            change={`+${stats.recentSignups}`}
            changeType="positive"
          />
        ) : (
          <SkeletonCard title="Total Users" />
        )}

        {stats ? (
          <MetricCard
            title="Active Users"
            value={stats.activeUsers.toLocaleString()}
            subtitle={activeUserPercentage ? `${activeUserPercentage}% of total` : 'No users yet'}
          />
        ) : (
          <SkeletonCard title="Active Users" />
        )}

        {activity ? (
          <MetricCard
            title="Recent Activity"
            value={activity.length.toString()}
            subtitle="Last 24 hours"
          />
        ) : (
          <SkeletonCard title="Recent Activity" />
        )}
      </div>

      {/* Recent Activity */}
      <RecentActivity activities={activity || []} />
    </div>
  );
}
