import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Users } from 'lucide-react';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { api } from '../../../convex/_generated/api';

export const Route = createFileRoute('/admin/stats')({
  component: SystemStats,
  errorComponent: AdminErrorBoundary,
});

function SystemStats() {
  // Use Convex query directly - enables real-time updates automatically
  const stats = useQuery(api.admin.getSystemStats);

  if (stats === undefined) {
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
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">System Statistics</h1>
          <p className="mt-2 text-sm text-gray-600">
            Overview of system usage and performance metrics (updates in real-time)
          </p>
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
