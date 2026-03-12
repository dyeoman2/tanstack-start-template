import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/organizations/$slug/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/app/organizations/$slug/settings',
      params,
      replace: true,
    });
  },
});
