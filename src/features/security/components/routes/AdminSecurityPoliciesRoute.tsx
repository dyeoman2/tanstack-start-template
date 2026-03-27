import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
import { useCallback, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { useToast } from '~/components/ui/toast';
import {
  AdminSecurityPolicyDetail,
  PolicySourceCollapsible,
} from '~/features/security/components/AdminSecurityPolicyDetail';
import { DetailLoadingState } from '~/features/security/components/routes/AdminSecurityRouteShared';
import {
  getSecurityPath,
  useSecurityNavigation,
} from '~/features/security/components/routes/securityRouteUtils';
import { AdminSecurityPoliciesTab } from '~/features/security/components/tabs/AdminSecurityPoliciesTab';
import { POLICY_TABLE_SORT_FIELDS } from '~/features/security/constants';
import type { SecurityPoliciesSearch } from '~/features/security/search';
import type { SecurityPolicyDetail, SecurityPolicySummary } from '~/features/security/types';

export function AdminSecurityPoliciesRoute(props: { search: SecurityPoliciesSearch }) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigateToControl } = useSecurityNavigation();
  const {
    policySearch,
    policySortBy,
    policySortOrder,
    policySupport,
    selectedPolicy: selectedPolicyId,
  } = props.search;
  const policySummaries = useQuery(api.securityPolicies.listSecurityPolicies, {}) as
    | SecurityPolicySummary[]
    | undefined;
  const selectedPolicy = useQuery(
    api.securityPolicies.getSecurityPolicyDetail,
    selectedPolicyId ? { policyId: selectedPolicyId } : 'skip',
  ) as SecurityPolicyDetail | null | undefined;
  const syncSecurityPoliciesFromSeed = useAction(api.securityPolicies.syncSecurityPoliciesFromSeed);
  const [isSyncingPolicies, setIsSyncingPolicies] = useState(false);

  const handleSyncPolicies = useCallback(async () => {
    setIsSyncingPolicies(true);
    try {
      await syncSecurityPoliciesFromSeed({});
      showToast('Policy catalog synced from repo markdown.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to sync policies.', 'error');
    } finally {
      setIsSyncingPolicies(false);
    }
  }, [showToast, syncSecurityPoliciesFromSeed]);

  const updatePolicySearch = useCallback(
    (
      updates: Partial<{
        policySearch: string;
        policySortBy: (typeof POLICY_TABLE_SORT_FIELDS)[number];
        policySortOrder: 'asc' | 'desc';
        policySupport: 'all' | SecurityPolicySummary['support'];
        selectedPolicy: string | undefined;
      }>,
    ) => {
      void navigate({
        search: {
          ...props.search,
          ...updates,
        },
        to: getSecurityPath('policies'),
      });
    },
    [navigate, props.search],
  );

  return (
    <>
      <AdminSecurityPoliciesTab
        busySync={isSyncingPolicies}
        onOpenPolicy={(policyId) => {
          updatePolicySearch({ selectedPolicy: policyId });
        }}
        onSyncPolicies={handleSyncPolicies}
        policies={policySummaries}
        searchTerm={policySearch}
        sortBy={policySortBy}
        sortOrder={policySortOrder}
        supportFilter={policySupport}
        updatePolicySearch={updatePolicySearch}
      />

      <Sheet
        open={selectedPolicyId !== undefined}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          updatePolicySearch({ selectedPolicy: undefined });
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Security policy detail</SheetTitle>
            <SheetDescription>
              Review the selected policy, its mapped controls, and annual review linkage.
            </SheetDescription>
          </SheetHeader>
          {selectedPolicy === undefined && selectedPolicyId ? (
            <DetailLoadingState label="Loading policy detail" />
          ) : selectedPolicy ? (
            <AdminSecurityPolicyDetail onOpenControl={navigateToControl} policy={selectedPolicy}>
              {selectedPolicy.sourceMarkdown ? (
                <PolicySourceCollapsible policy={selectedPolicy} />
              ) : null}
            </AdminSecurityPolicyDetail>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
