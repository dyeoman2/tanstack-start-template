import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { OrganizationMembersManagement } from '~/features/organizations/components/OrganizationMembersManagement';
import {
  ORGANIZATION_DIRECTORY_KIND_VALUES,
  ORGANIZATION_DIRECTORY_SORT_FIELDS,
} from '~/features/organizations/lib/organization-management';

const organizationMembersSearchSchema = z.object({
  page: z.number().default(1),
  pageSize: z.number().default(10),
  sortBy: z.enum(ORGANIZATION_DIRECTORY_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  secondarySortBy: z.enum(ORGANIZATION_DIRECTORY_SORT_FIELDS).default('email'),
  secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  kind: z.enum(ORGANIZATION_DIRECTORY_KIND_VALUES).default('all'),
});

export const Route = createFileRoute('/app/organizations/$slug/members')({
  validateSearch: organizationMembersSearchSchema,
  component: OrganizationMembersRoute,
  errorComponent: DashboardErrorBoundary,
});

function OrganizationMembersRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  return <OrganizationMembersManagement slug={slug} searchParams={search} />;
}
