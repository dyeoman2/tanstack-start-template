import { useLocation } from '@tanstack/react-router';
import { OrganizationMembersManagement } from '~/features/organizations/components/OrganizationMembersManagement';
import { OrganizationWorkspaceTabs } from '~/features/organizations/components/OrganizationWorkspaceTabs';
import { getOrganizationBreadcrumbName } from '~/features/organizations/lib/organization-breadcrumb-state';
import type { OrganizationDirectorySearchParams } from '~/features/organizations/lib/organization-management';

export function OrganizationMembersPage({
  searchParams,
  slug,
}: {
  searchParams: OrganizationDirectorySearchParams;
  slug: string;
}) {
  const location = useLocation();
  const organizationName = getOrganizationBreadcrumbName(location.state, slug);

  return (
    <OrganizationMembersManagement
      slug={slug}
      searchParams={searchParams}
      fallbackOrganizationName={organizationName}
      subnav={<OrganizationWorkspaceTabs slug={slug} organizationName={organizationName} />}
    />
  );
}
