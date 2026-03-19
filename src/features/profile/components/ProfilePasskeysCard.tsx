import type { Passkey } from '@better-auth/passkey';
import { formatDistanceToNow } from 'date-fns';
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { authClient, authHooks } from '~/features/auth/auth-client';

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

  return 'Something went wrong while updating your passkeys.';
}

function getPasskeyLabel(passkey: Passkey) {
  const name =
    'name' in passkey && typeof passkey.name === 'string' && passkey.name.trim().length > 0
      ? passkey.name.trim()
      : null;

  const deviceType =
    'deviceType' in passkey &&
    typeof passkey.deviceType === 'string' &&
    passkey.deviceType.length > 0
      ? passkey.deviceType
      : null;

  return name ?? deviceType ?? 'Passkey';
}

function getPasskeyCreatedAt(passkey: Passkey) {
  const createdAt = 'createdAt' in passkey ? passkey.createdAt : null;
  if (!createdAt) {
    return null;
  }

  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ProfilePasskeysCard() {
  const { showToast } = useToast();
  const { data, isPending, refetch } = authHooks.useListPasskeys();
  const [pendingDeletionId, setPendingDeletionId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passkeys = useMemo(() => data ?? [], [data]);

  const handleAddPasskey = async () => {
    setIsAdding(true);
    setError(null);

    try {
      const response = await authClient.passkey.addPasskey({
        fetchOptions: { throw: true },
      });

      if (response?.error) {
        throw response.error;
      }

      await refetch?.();
      showToast('Passkey added.', 'success');
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeletePasskey = async (passkeyId: string) => {
    setPendingDeletionId(passkeyId);
    setError(null);

    try {
      await authClient.passkey.deletePasskey({
        id: passkeyId,
        fetchOptions: { throw: true },
      });
      await refetch?.();
      showToast('Passkey removed.', 'success');
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      showToast(message, 'error');
    } finally {
      setPendingDeletionId(null);
    }
  };

  return (
    <Card className="w-full gap-0 overflow-hidden rounded-xl border border-border shadow-sm">
      <CardHeader className="border-b">
        <CardTitle className="font-semibold leading-none text-base">Passkeys</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Use passkeys for phishing-resistant sign-in and as a valid multi-factor method.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 py-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {isPending ? <PasskeysLoadingState /> : null}

        {!isPending && passkeys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="size-4" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No passkeys added yet</p>
                <p className="text-sm text-muted-foreground">
                  Add a passkey to sign in faster on supported devices and browsers.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {!isPending && passkeys.length > 0 ? (
          <div className="space-y-3">
            {passkeys.map((passkey) => {
              const createdAt = getPasskeyCreatedAt(passkey);
              const isDeleting = pendingDeletionId === passkey.id;

              return (
                <div
                  key={passkey.id}
                  className="flex flex-col gap-4 rounded-lg border border-border bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ShieldCheck className="size-4" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {getPasskeyLabel(passkey)}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span>
                          Created{' '}
                          {createdAt
                            ? formatDistanceToNow(createdAt, { addSuffix: true })
                            : 'recently'}
                        </span>
                        {'credentialDeviceType' in passkey &&
                        typeof passkey.credentialDeviceType === 'string' &&
                        passkey.credentialDeviceType.length > 0 ? (
                          <span className="capitalize">{passkey.credentialDeviceType}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void handleDeletePasskey(passkey.id);
                    }}
                    disabled={isDeleting || isAdding}
                  >
                    {isDeleting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex justify-start">
          <Button
            type="button"
            onClick={() => void handleAddPasskey()}
            disabled={isAdding || pendingDeletionId !== null}
          >
            {isAdding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add passkey
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PasskeysLoadingState() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}
