import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Building2, Check, Loader2, Mail, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { authClient, authHooks } from '~/features/auth/auth-client';
import {
  getOrganizationActionErrorMessage,
  refreshOrganizationClientState,
} from '~/features/organizations/lib/organization-session';

type UserInvitation = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  inviterId: string;
  status: string;
  expiresAt: string | Date;
  createdAt: string | Date;
};

export function UserInvitationInbox() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data, isPending } = authHooks.useAuthQuery<UserInvitation[]>({
    queryKey: ['user-invitations'],
    queryFn: ({ fetchOptions }) =>
      authClient.organization.listUserInvitations({
        fetchOptions,
      }),
  });
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);

  const invitations = useMemo(() => {
    return (data ?? []).filter((invitation) => {
      return (
        invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() > Date.now()
      );
    });
  }, [data]);

  const handleAccept = async (invitationId: string) => {
    setPendingInvitationId(invitationId);

    try {
      await authClient.organization.acceptInvitation({
        invitationId,
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
      showToast(getOrganizationActionErrorMessage(error, 'Failed to accept invitation'), 'error');
    } finally {
      setPendingInvitationId(null);
    }
  };

  const handleReject = async (invitationId: string) => {
    setPendingInvitationId(invitationId);

    try {
      await authClient.organization.rejectInvitation({
        invitationId,
        fetchOptions: { throw: true },
      });
      await refreshOrganizationClientState(queryClient);
      showToast('Invitation rejected.', 'success');
    } catch (error) {
      showToast(getOrganizationActionErrorMessage(error, 'Failed to reject invitation'), 'error');
    } finally {
      setPendingInvitationId(null);
    }
  };

  if (isPending) {
    return <InvitationInboxSkeleton />;
  }

  if (invitations.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden rounded-xl border border-border shadow-sm">
      <CardHeader className="px-6 pb-4">
        <CardTitle className="text-base font-semibold">Pending invitations</CardTitle>
        <CardDescription className="text-sm leading-6 text-muted-foreground">
          Review organization invites and decide whether to join each workspace.
        </CardDescription>
      </CardHeader>
      <div className="space-y-3 px-6 pb-6">
        {invitations.map((invitation) => {
          const isWorking = pendingInvitationId === invitation.id;

          return (
            <div
              key={invitation.id}
              className="flex flex-col gap-4 rounded-lg border border-border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-foreground">
                      {invitation.organizationName}
                    </p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                      {invitation.role}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3.5" />
                      {invitation.email}
                    </span>
                    <span>Expires {formatDate(invitation.expiresAt)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleReject(invitation.id);
                  }}
                  disabled={isWorking}
                >
                  {isWorking ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <X className="size-4" />
                  )}
                  Reject
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handleAccept(invitation.id);
                  }}
                  disabled={isWorking}
                >
                  {isWorking ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Accept
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function InvitationInboxSkeleton() {
  return (
    <Card className="overflow-hidden rounded-xl border border-border shadow-sm">
      <CardHeader className="px-6 pb-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-80" />
      </CardHeader>
      <div className="space-y-3 px-6 pb-6">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </Card>
  );
}

function formatDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString();
}
