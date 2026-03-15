import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/organizations/$slug/domains')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/organizations/$slug/identity',
      params,
      replace: true,
    });
  },
});
