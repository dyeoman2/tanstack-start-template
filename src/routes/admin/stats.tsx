import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { useMemo } from 'react';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { getSystemStatsServerFn } from '~/features/dashboard/admin.server';
import { ADMIN_KEYS } from '~/lib/query-keys';

export const Route = createFileRoute('/admin/stats')({
  component: SystemStats,
  errorComponent: AdminErrorBoundary,
  loader: async () => {
    return await getSystemStatsServerFn();
  },
});

function SystemStats() {
  // Get initial data from loader
  const loaderData = Route.useLoaderData();
  const loaderFetchedAt = useMemo(() => Date.now(), []);

  const {
    data: stats,
    isPending: statsPending,
    refetch,
  } = useQuery({
    queryKey: ADMIN_KEYS.STATS,
    queryFn: () => getSystemStatsServerFn(),
    initialData: loaderData, // Use loader data as initial data
    initialDataUpdatedAt: loaderFetchedAt,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  if (statsPending) {
    return <div>Loading...</div>;
  }

  const statCards = [
    {
      title: 'Total Users',
      value: stats?.users || 0,
      icon: Users,
      description: 'Registered users in the system',
    },
  ];

  return (
    <ErrorBoundaryWrapper
      title="System Statistics Error"
      description="Failed to load system statistics. This might be due to a temporary data issue."
    >
      <div className="px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">System Statistics</h1>
            <p className="mt-2 text-sm text-gray-600">
              Overview of system usage and performance metrics
            </p>
          </div>
          <Button onClick={() => refetch()} variant="outline">
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">{stat.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </ErrorBoundaryWrapper>
  );
}
