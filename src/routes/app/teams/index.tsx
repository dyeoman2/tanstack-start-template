import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/app/teams/')({
  beforeLoad: () => {
    throw redirect({
      to: '/app/organizations',
      replace: true,
    });
  },
});
