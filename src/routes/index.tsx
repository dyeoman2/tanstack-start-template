import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuthStatusServerFn } from '~/features/auth/server/session.server';
import { MarketingHome } from '~/features/marketing/components/MarketingHome';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { isAuthenticated } = await getAuthStatusServerFn();
    if (isAuthenticated) {
      throw redirect({ to: '/app' });
    }
  },
  component: MarketingHomeRoute,
});

function MarketingHomeRoute() {
  return <MarketingHome />;
}
