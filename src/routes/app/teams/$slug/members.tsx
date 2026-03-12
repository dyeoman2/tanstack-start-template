import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/teams/$slug/members')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/organizations/$slug/members',
      params,
      replace: true,
    });
  },
});
