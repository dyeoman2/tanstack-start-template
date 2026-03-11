import { createFileRoute } from '@tanstack/react-router';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { TeamManagementPage } from '~/features/teams/components/TeamManagementPage';

export const Route = createFileRoute('/app/teams')({
  component: TeamManagementPage,
  errorComponent: DashboardErrorBoundary,
});
