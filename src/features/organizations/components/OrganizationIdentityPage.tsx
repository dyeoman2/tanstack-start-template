import { api } from '@convex/_generated/api';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { OrganizationDomainManagement } from '~/features/organizations/components/OrganizationDomainManagement';
import { OrganizationEnterpriseAuthManagement } from '~/features/organizations/components/OrganizationEnterpriseAuthManagement';
import { OrganizationProvisioningManagement } from '~/features/organizations/components/OrganizationProvisioningManagement';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { getOrganizationBreadcrumbName } from '~/features/organizations/lib/organization-breadcrumb-state';

export function OrganizationIdentityPage({
  slug,
}: {
  slug: string;
}) {
  const location = useLocation();
  const settings = useQuery(api.organizationManagement.getOrganizationSettings, { slug });
  const optimisticOrganizationName = getOrganizationBreadcrumbName(location.state, slug);
  const organizationName =
    settings?.organization.name ?? optimisticOrganizationName ?? 'Loading organization';

  if (settings === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization not found</CardTitle>
          <CardDescription>
            The requested organization is unavailable or you no longer have access to it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        title={organizationName}
        description="Manage single sign-on, user provisioning, and verified domains for your organization."
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />
      <OrganizationEnterpriseAuthManagement slug={slug} />
      <OrganizationDomainManagement slug={slug} />
      <OrganizationProvisioningManagement slug={slug} />
    </div>
  );
}
