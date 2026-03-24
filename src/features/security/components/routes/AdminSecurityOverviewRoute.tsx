import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { AdminSecurityOverviewTab } from '~/features/security/components/tabs/AdminSecurityOverviewTab';
import type { SecurityWorkspaceOverview } from '~/features/security/types';

export function AdminSecurityOverviewRoute() {
  const workspaceOverview = useQuery(api.securityPosture.getSecurityWorkspaceOverview, {}) as
    | SecurityWorkspaceOverview
    | undefined;

  return (
    <AdminSecurityOverviewTab
      controlSummary={workspaceOverview?.controlSummary}
      summary={workspaceOverview?.postureSummary}
    />
  );
}
