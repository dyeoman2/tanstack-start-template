import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Switch } from '~/components/ui/switch';
import { useToast } from '~/components/ui/toast';
import { authClient, useSession } from '~/features/auth/auth-client';
import { BackupCodesDialog } from '~/features/auth/components/BackupCodesDialog';

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

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

export function ProfileTwoFactorCard() {
  const { data: sessionData, isPending } = useSession();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBackupCodesOpen, setIsBackupCodesOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingTotpUri, setPendingTotpUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isContinuingToAuthenticator, setIsContinuingToAuthenticator] = useState(false);

  const isTwoFactorEnabled = useMemo(
    () =>
      (sessionData?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled === true,
    [sessionData],
  );

  async function handleEnable() {
    if (!password) {
      showToast('Password is required.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await authClient.twoFactor.enable({
        password,
        fetchOptions: { throw: true },
      });

      setPassword('');
      setPendingTotpUri(response.totpURI ?? null);
      setBackupCodes(response.backupCodes ?? []);
      setIsDialogOpen(false);
      setIsBackupCodesOpen(true);
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDisable() {
    if (!password) {
      showToast('Password is required.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      await authClient.twoFactor.disable({
        password,
        fetchOptions: { throw: true },
      });

      setPassword('');
      setIsDialogOpen(false);
      showToast('Two-factor authentication has been disabled.', 'success');
      window.location.reload();
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleContinueToAuthenticator() {
    setIsContinuingToAuthenticator(true);

    const search = pendingTotpUri ? `?totpURI=${encodeURIComponent(pendingTotpUri)}` : '';

    window.setTimeout(() => {
      window.location.assign(`/two-factor${search}`);
    }, 0);
  }

  const instructions = isTwoFactorEnabled
    ? 'Enter your password to disable your authenticator app.'
    : 'Enter your password to enable your authenticator app and finish setup.';

  return (
    <>
      <Card className="w-full gap-0 overflow-hidden rounded-xl border border-border shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="font-semibold leading-none text-base md:text-base">
            Authenticator app
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Require a 6-digit code from your authenticator app when signing in with your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 py-6">
          <div className="flex items-start gap-4">
            <Switch
              checked={isTwoFactorEnabled}
              disabled={isPending}
              aria-label={isTwoFactorEnabled ? 'Disable two-factor' : 'Enable two-factor'}
              onCheckedChange={() => setIsDialogOpen(true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {isTwoFactorEnabled
                  ? 'Authenticator app is enabled'
                  : 'Authenticator app is disabled'}
              </p>
              {!isTwoFactorEnabled ? (
                <p className="text-sm text-muted-foreground">
                  Turn on authenticator-app verification for extra account security.
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Authenticator app</DialogTitle>
            <DialogDescription>{instructions}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="two-factor-password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <Input
                id="two-factor-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={isTwoFactorEnabled ? handleDisable : handleEnable}
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {isTwoFactorEnabled ? 'Disable authenticator app' : 'Enable authenticator app'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BackupCodesDialog
        open={isBackupCodesOpen}
        onOpenChange={(open) => {
          setIsBackupCodesOpen(open);
          if (!open) {
            setIsContinuingToAuthenticator(false);
          }
        }}
        backupCodes={backupCodes}
        onContinue={handleContinueToAuthenticator}
        isContinuing={isContinuingToAuthenticator}
      />
    </>
  );
}
