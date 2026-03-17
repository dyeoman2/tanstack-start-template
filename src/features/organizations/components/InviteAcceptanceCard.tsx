import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useRouter } from '@tanstack/react-router';
import { Check, Loader2, Mail, X } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { authClient, authHooks } from '~/features/auth/auth-client';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';

function getErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null &&
    'message' in error.error &&
    typeof error.error.message === 'string'
  ) {
    return error.error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to process the invitation.';
}

export function InviteAcceptanceCard({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const { isAuthenticated, isPending: authPending } = useAuthState();
  const {
    data: invitation,
    isPending,
    error,
  } = authHooks.useInvitation({
    id: token,
  });
  const [pendingAction, setPendingAction] = useState<'accept' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (authPending) {
    return <InviteAcceptanceSkeleton />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        search={{
          redirectTo: `/invite/${token}`,
        }}
        replace
      />
    );
  }

  const handleAccept = async () => {
    setPendingAction('accept');
    setActionError(null);

    try {
      await authClient.organization.acceptInvitation({
        invitationId: token,
        fetchOptions: { throw: true },
      });
      await refreshOrganizationClientState(queryClient, {
        invalidateRouter: async () => {
          await router.invalidate();
        },
      });
      showToast('Invitation accepted.', 'success');
      await navigate({ to: '/app/organizations' });
    } catch (error) {
      const message = getErrorMessage(error);
      setActionError(message);
      showToast(message, 'error');
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async () => {
    setPendingAction('reject');
    setActionError(null);

    try {
      await authClient.organization.rejectInvitation({
        invitationId: token,
        fetchOptions: { throw: true },
      });
      await refreshOrganizationClientState(queryClient, {
        invalidateRouter: async () => {
          await router.invalidate();
        },
      });
      showToast('Invitation rejected.', 'success');
      await navigate({ to: '/app/organizations' });
    } catch (error) {
      const message = getErrorMessage(error);
      setActionError(message);
      showToast(message, 'error');
    } finally {
      setPendingAction(null);
    }
  };

  if (isPending) {
    return <InviteAcceptanceSkeleton />;
  }

  if (!invitation) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl">Invitation unavailable</CardTitle>
          <CardDescription>
            This invitation is invalid, expired, or has already been used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            type="button"
            onClick={() => navigate({ to: '/app/organizations' })}
          >
            Go to organizations
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-3xl">Organization invitation</CardTitle>
        <CardDescription>
          Review this invitation and choose whether to join the workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Mail className="size-4 text-muted-foreground" />
              {invitation.email}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{invitation.organizationName}</p>
              <p className="text-sm text-muted-foreground capitalize">Role: {invitation.role}</p>
            </div>
          </div>
        </div>

        {actionError || error ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError ?? getErrorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              void handleReject();
            }}
            disabled={pendingAction !== null}
          >
            {pendingAction === 'reject' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <X className="size-4" />
            )}
            Reject
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={() => {
              void handleAccept();
            }}
            disabled={pendingAction !== null}
          >
            {pendingAction === 'accept' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Accept invitation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InviteAcceptanceSkeleton() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1 rounded-md" />
          <Skeleton className="h-10 flex-1 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}
