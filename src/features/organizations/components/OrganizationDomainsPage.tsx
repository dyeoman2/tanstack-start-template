import { api } from '@convex/_generated/api';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { OrganizationDomainManagement } from '~/features/organizations/components/OrganizationDomainManagement';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { useStableOrganizationName } from '~/features/organizations/lib/organization-breadcrumb-state';

export function OrganizationDomainsPage({ slug }: { slug: string }) {
  const location = useLocation();
  const response = useQuery(api.organizationManagement.listOrganizationDomains, { slug });
  const organizationName = useStableOrganizationName({
    names: [response?.organization.name],
    slug,
    state: location.state,
  });

  if (response === null) {
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
        description="Manage verified domains for organization ownership and identity."
      />
      <OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />
      <OrganizationDomainManagement slug={slug} />
    </div>
  );
}
