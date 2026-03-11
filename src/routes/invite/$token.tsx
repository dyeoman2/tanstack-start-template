import { api } from '@convex/_generated/api';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { useAuthState } from '~/features/auth/hooks/useAuthState';

export const Route = createFileRoute('/invite/$token')({
  component: InviteAcceptancePage,
});

function InviteAcceptancePage() {
  const { token } = Route.useParams();
  const authState = useAuthState();
  const invite = useQuery(api.teams.getInvitePreview, { token });
  const acceptInvite = useMutation(api.teams.acceptInvite);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleAccept() {
    try {
      const result = await acceptInvite({ token });
      setStatusMessage(`Joined ${result.teamName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to accept invite.');
    }
  }

  return (
    <div className="container mx-auto max-w-2xl p-6 space-y-6">
      <PageHeader
        title="Team Invite"
        description="Accept a team invitation."
      />

      {!invite && <p className="text-sm text-muted-foreground">Invite not found.</p>}

      {invite && (
        <div className="rounded-lg border p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{invite.team.name}</h2>
            <p className="text-sm text-muted-foreground">
              {invite.email} invited as {invite.role}
            </p>
          </div>

          {invite.status !== 'pending' ? (
            <p className="text-sm text-muted-foreground capitalize">Invite status: {invite.status}</p>
          ) : authState.isAuthenticated ? (
            <Button onClick={() => void handleAccept()}>Accept Invite</Button>
          ) : (
            <div className="flex gap-3">
              <Button asChild>
                <Link to="/login" search={{ redirect: `/invite/${token}` }}>
                  Sign in
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/register">Create account</Link>
              </Button>
            </div>
          )}

          {statusMessage && <p className="text-sm text-muted-foreground">{statusMessage}</p>}
        </div>
      )}
    </div>
  );
}
