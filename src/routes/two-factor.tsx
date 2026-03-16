import { AuthView } from '@daveyplate/better-auth-ui';
import { createFileRoute } from '@tanstack/react-router';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';

export const Route = createFileRoute('/two-factor')({
  staticData: true,
  component: TwoFactorPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
});

function TwoFactorPage() {
  return (
    <AuthRouteShell>
      <AuthView view="TWO_FACTOR" />
    </AuthRouteShell>
  );
}
