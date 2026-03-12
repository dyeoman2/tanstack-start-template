import { AcceptInvitationCard } from '@daveyplate/better-auth-ui';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';

export const Route = createFileRoute('/invite/$token')({
  component: InviteAcceptancePage,
});

function InviteAcceptancePage() {
  const { token } = Route.useParams();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    let hasChanged = false;

    if (searchParams.get('invitationId') !== token) {
      searchParams.set('invitationId', token);
      hasChanged = true;
    }

    if (!searchParams.get('redirectTo')) {
      searchParams.set('redirectTo', '/app/organizations');
      hasChanged = true;
    }

    if (hasChanged) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}?${searchParams.toString()}`,
      );
    }

    setIsReady(true);
  }, [token]);

  if (!isReady) {
    return <AuthSkeleton />;
  }

  return (
    <AuthRouteShell>
      <AcceptInvitationCard />
    </AuthRouteShell>
  );
}
