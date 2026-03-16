import { AuthView } from '@daveyplate/better-auth-ui';
import { createFileRoute } from '@tanstack/react-router';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';

export const Route = createFileRoute('/recover-account')({
  staticData: true,
  component: RecoverAccountPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
});

function RecoverAccountPage() {
  return (
    <AuthRouteShell>
      <AuthView view="RECOVER_ACCOUNT" />
    </AuthRouteShell>
  );
}
