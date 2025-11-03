import { createFileRoute } from '@tanstack/react-router';
import { MarketingHome } from '~/features/marketing/components/MarketingHome';

export const Route = createFileRoute('/')({
  staticData: true,
  head: () => ({
    meta: [
      {
        title: 'TanStack Start Template — Home',
      },
    ],
  }),
  component: MarketingHomeRoute,
});

function MarketingHomeRoute() {
  return <MarketingHome />;
}
