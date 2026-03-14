import { createFileRoute, redirect } from '@tanstack/react-router';
import { organizationDirectorySearchSchema } from '~/features/organizations/lib/organization-management';

export const Route = createFileRoute('/app/teams/$slug/members')({
  validateSearch: organizationDirectorySearchSchema,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/app/organizations/$slug/settings',
      params,
      search,
      replace: true,
    });
  },
});
