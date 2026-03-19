import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { AccountSetupPage } from '~/features/auth/components/AccountSetupPage';

export const Route = createFileRoute('/account-setup')({
  staticData: true,
  component: AccountSetupRoute,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    email: z.string().email().optional(),
    redirectTo: z.string().regex(/^\/.*/).optional(),
    verified: z.string().optional(),
  }),
});

function AccountSetupRoute() {
  const search = Route.useSearch();
  return <AccountSetupPage {...search} />;
}
