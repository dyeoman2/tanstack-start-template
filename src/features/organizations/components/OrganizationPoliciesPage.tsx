import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { useToast } from '~/components/ui/toast';
import { OrganizationPoliciesCard } from '~/features/organizations/components/OrganizationPoliciesCard';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { useStableOrganizationName } from '~/features/organizations/lib/organization-breadcrumb-state';
import type { OrganizationInvitePolicy } from '~/features/organizations/lib/organization-management';
import {
  getServerFunctionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';
import { updateOrganizationPoliciesServerFn } from '~/features/organizations/server/organization-management';

export function OrganizationPoliciesPage({ slug }: { slug: string }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const settings = useQuery(api.organizationManagement.getOrganizationSettings, { slug });
  const enterpriseAccess = useQuery(
    api.organizationManagement.getOrganizationEnterpriseAccessBySlug,
    {
      slug,
      permission: 'managePolicies',
    },
  );
  const updatePolicies = updateOrganizationPoliciesServerFn;
  const [invitePolicy, setInvitePolicy] = useState<OrganizationInvitePolicy>('owners_admins');
  const [verifiedDomainsOnly, setVerifiedDomainsOnly] = useState(false);
  const [memberCap, setMemberCap] = useState('');
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [isSavingPolicies, setIsSavingPolicies] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setInvitePolicy(settings.policies.invitePolicy);
    setVerifiedDomainsOnly(settings.policies.verifiedDomainsOnly);
    setMemberCap(settings.policies.memberCap?.toString() ?? '');
  }, [settings]);

  const organizationName = useStableOrganizationName({
    names: [settings?.organization.name],
    slug,
    state: location.state,
  });

  if (settings === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {enterpriseAccess &&
            enterpriseAccess.requiresEnterpriseAuth &&
            !enterpriseAccess.allowed
              ? 'Enterprise sign-in required'
              : 'Organization not found'}
          </CardTitle>
          <CardDescription>
            {enterpriseAccess &&
            enterpriseAccess.requiresEnterpriseAuth &&
            !enterpriseAccess.allowed
              ? (enterpriseAccess.reason ??
                'Use your managed enterprise identity before opening this organization.')
              : 'The requested organization is unavailable or you no longer have access to it.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleSavePolicies = async () => {
    if (!settings) {
      return;
    }

    setIsSavingPolicies(true);
    setPolicyError(null);

    try {
      await updatePolicies({
        data: {
          organizationId: settings.organization.id,
          invitePolicy,
          verifiedDomainsOnly,
          memberCap: memberCap.trim().length > 0 ? Number.parseInt(memberCap, 10) : null,
          mfaRequired: settings.policies.mfaRequired,
          enterpriseAuthMode: settings.policies.enterpriseAuthMode,
          enterpriseProviderKey: settings.policies.enterpriseProviderKey,
          enterpriseProtocol: settings.policies.enterpriseProtocol,
          allowBreakGlassPasswordLogin: settings.policies.allowBreakGlassPasswordLogin,
        },
      });
      await refreshOrganizationClientState(queryClient, {
        invalidateRouter: async () => {
          await router.invalidate();
        },
      });
      showToast('Organization policies updated.', 'success');
    } catch (error) {
      const message = getServerFunctionErrorMessage(
        error,
        'Failed to update organization policies',
      );
      setPolicyError(message);
      showToast(message, 'error');
    } finally {
      setIsSavingPolicies(false);
    }
  };

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        title={organizationName}
        description="Manage invitation, join, and membership guardrails for this organization."
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />

      {settings === undefined ? null : (
        <OrganizationPoliciesCard
          canManagePolicies={settings.capabilities.canManagePolicies}
          invitePolicy={invitePolicy}
          verifiedDomainsOnly={verifiedDomainsOnly}
          memberCap={memberCap}
          policyError={policyError}
          isSavingPolicies={isSavingPolicies}
          onInvitePolicyChange={setInvitePolicy}
          onVerifiedDomainsOnlyChange={setVerifiedDomainsOnly}
          onMemberCapChange={setMemberCap}
          onSave={handleSavePolicies}
        />
      )}
    </div>
  );
}
