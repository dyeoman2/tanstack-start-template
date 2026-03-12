import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/teams/$slug/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/organizations/$slug',
      params,
      replace: true,
    });
  },
});
