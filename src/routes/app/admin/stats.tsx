import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Users } from 'lucide-react';
import { PageHeader } from '~/components/PageHeader';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/admin/stats')({
  component: SystemStats,
  errorComponent: AdminErrorBoundary,
});

function SystemStats() {
  usePerformanceMonitoring('SystemStats');

  // Use Convex query directly - enables real-time updates automatically
  const stats = useQuery(api.admin.getSystemStats);

  if (stats === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="System Statistics"
          description="Overview of system usage and performance metrics (updates in real-time)"
        />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="animate-pulse bg-gray-100 rounded-lg h-32" />
          <div className="animate-pulse bg-gray-100 rounded-lg h-32" />
          <div className="animate-pulse bg-gray-100 rounded-lg h-32" />
        </div>
      </div>
    );
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
    <div className="space-y-6">
      <PageHeader
        title="System Statistics"
        description="Overview of system usage and performance metrics (updates in real-time)"
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
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
  );
}
