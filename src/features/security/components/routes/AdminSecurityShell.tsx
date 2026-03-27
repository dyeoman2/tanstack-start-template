import { useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import { api } from '@convex/_generated/api';
import { PageHeader } from '~/components/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs';
import type { SecurityWorkspaceOverview } from '~/features/security/types';
import {
  getSecurityPath,
  isSecurityTab,
} from '~/features/security/components/routes/securityRouteUtils';
import type { SecurityTab } from '~/features/security/search';

function TabBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-destructive/15 text-[10px] font-medium text-destructive">
      {count}
    </span>
  );
}

function SecurityPageShell(props: { activeTab: SecurityTab; children: React.ReactNode }) {
  const navigate = useNavigate();
  const workspaceOverview = useQuery(api.securityPosture.getSecurityWorkspaceOverview, {}) as
    | SecurityWorkspaceOverview
    | undefined;
  const queues = workspaceOverview?.queues;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Posture"
        description="Review controls, policies, vendors, findings, evidence reports, and review workflows."
      />

      <Tabs
        value={props.activeTab}
        onValueChange={(value) => {
          if (!isSecurityTab(value) || value === props.activeTab) {
            return;
          }

          void navigate({
            to: getSecurityPath(value),
          });
        }}
      >
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="vendors">
            Vendors
            <TabBadge count={workspaceOverview?.vendorSummary?.overdueCount} />
          </TabsTrigger>
          <TabsTrigger value="findings">
            Findings
            <TabBadge count={queues?.undispositionedFindings} />
          </TabsTrigger>
          <TabsTrigger value="reviews">
            Reviews
            <TabBadge count={queues?.blockedReviewTasks} />
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {props.children}
    </div>
  );
}

export function AdminSecurityLayout(props: { children: React.ReactNode }) {
  const location = useLocation();

  const activeTab = useMemo<SecurityTab>(() => {
    const pathname = location.pathname;

    if (pathname === getSecurityPath('controls')) return 'controls';
    if (pathname === getSecurityPath('policies')) return 'policies';
    if (pathname === getSecurityPath('vendors')) return 'vendors';
    if (pathname === getSecurityPath('findings')) return 'findings';
    if (pathname === getSecurityPath('reviews')) return 'reviews';
    return 'overview';
  }, [location.pathname]);

  return <SecurityPageShell activeTab={activeTab}>{props.children}</SecurityPageShell>;
}

export function AdminSecurityPageShell(props: {
  activeTab: SecurityTab;
  children: React.ReactNode;
}) {
  return <SecurityPageShell activeTab={props.activeTab}>{props.children}</SecurityPageShell>;
}
