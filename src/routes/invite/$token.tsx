import { createFileRoute } from '@tanstack/react-router';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { InviteAcceptanceCard } from '~/features/organizations/components/InviteAcceptanceCard';

export const Route = createFileRoute('/invite/$token')({
  component: InviteAcceptancePage,
});

function InviteAcceptancePage() {
  const { token } = Route.useParams();

  return (
    <AuthRouteShell>
      <InviteAcceptanceCard token={token} />
    </AuthRouteShell>
  );
}
