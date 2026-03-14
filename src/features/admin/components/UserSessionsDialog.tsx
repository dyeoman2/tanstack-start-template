import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, ShieldAlert, Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { useToast } from '~/components/ui/toast';
import {
  type AdminUserSession,
  listAdminUserSessionsServerFn,
  revokeAdminUserSessionServerFn,
  revokeAdminUserSessionsServerFn,
} from '../server/admin-management';
import type { User } from '../types';

interface UserSessionsDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
}

type SessionView = AdminUserSession;

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function getSessionIcon(userAgent: string | null) {
  if (!userAgent) {
    return Laptop;
  }

  const agent = userAgent.toLowerCase();
  if (agent.includes('iphone') || agent.includes('android') || agent.includes('mobile')) {
    return Smartphone;
  }

  return Laptop;
}

function formatSessionLabel(session: SessionView) {
  if (!session.userAgent) {
    return 'Unknown device';
  }

  return session.userAgent.length > 80 ? `${session.userAgent.slice(0, 77)}...` : session.userAgent;
}

export function UserSessionsDialog({ open, user, onClose }: UserSessionsDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(() => ['admin-user-sessions', user?.id ?? 'unknown'], [user?.id]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!user) {
        return [] satisfies SessionView[];
      }

      return await listAdminUserSessionsServerFn({
        data: {
          userId: user.id,
        },
      });
    },
    enabled: open && user !== null,
  });

  useEffect(() => {
    if (!open) {
      setError(null);
      setPendingSessionId(null);
      setConfirmSessionId(null);
      setConfirmRevokeAll(false);
      setIsRevokingAll(false);
    }
  }, [open]);

  const sessions = data ?? [];

  const handleRevokeSession = async (sessionId: string) => {
    setPendingSessionId(sessionId);
    setError(null);

    try {
      await revokeAdminUserSessionServerFn({
        data: {
          sessionId,
        },
      });
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setConfirmSessionId(null);
      showToast('Session revoked', 'success');
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke session');
    } finally {
      setPendingSessionId(null);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!user) {
      return;
    }

    setIsRevokingAll(true);
    setError(null);

    try {
      await revokeAdminUserSessionsServerFn({
        data: {
          userId: user.id,
        },
      });
      await refetch();
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setConfirmRevokeAll(false);
      showToast('All sessions revoked', 'success');
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke sessions');
    } finally {
      setIsRevokingAll(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Manage sessions</DialogTitle>
          <DialogDescription>
            Review active sessions for {user?.email ?? 'this user'} and revoke access where needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {isLoading || isFetching
                ? 'Loading sessions...'
                : `${sessions.length} active session${sessions.length === 1 ? '' : 's'}`}
            </p>
            {confirmRevokeAll ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRevokeAll(false)}
                  disabled={isRevokingAll}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    void handleRevokeAllSessions();
                  }}
                  disabled={isRevokingAll}
                >
                  {isRevokingAll ? 'Revoking...' : 'Confirm revoke all'}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                onClick={() => setConfirmRevokeAll(true)}
                disabled={sessions.length === 0 || isLoading || isFetching}
              >
                Revoke all sessions
              </Button>
            )}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {sessions.length === 0 && !isLoading ? (
            <Alert>
              <ShieldAlert className="size-4" />
              <AlertDescription>No active sessions found for this user.</AlertDescription>
            </Alert>
          ) : null}

          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-2">
            {sessions.map((session) => {
              const Icon = getSessionIcon(session.userAgent);
              const isPending = pendingSessionId === session.id;
              const isConfirming = confirmSessionId === session.id;

              return (
                <div key={session.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-muted p-2">
                        <Icon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{formatSessionLabel(session)}</p>
                        <p className="text-xs text-muted-foreground">
                          Created {formatDateTime(session.createdAt)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Expires {formatDateTime(session.expiresAt)}
                        </p>
                        {session.ipAddress ? (
                          <p className="text-xs text-muted-foreground">IP {session.ipAddress}</p>
                        ) : null}
                        {session.impersonatedBy ? (
                          <p className="text-xs text-orange-600">Started from impersonation</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-start">
                      {isConfirming ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmSessionId(null)}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              void handleRevokeSession(session.id);
                            }}
                            disabled={isPending}
                          >
                            {isPending ? 'Revoking...' : 'Confirm'}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost-destructive"
                          size="sm"
                          onClick={() => setConfirmSessionId(session.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
