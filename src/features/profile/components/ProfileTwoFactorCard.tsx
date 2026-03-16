import { CheckIcon, CopyIcon, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { authClient, useSession } from '~/features/auth/auth-client';

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
  const [didCopyBackupCodes, setDidCopyBackupCodes] = useState(false);

  const isTwoFactorEnabled = useMemo(
    () => (sessionData?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled === true,
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
    setIsBackupCodesOpen(false);
    setDidCopyBackupCodes(false);

    const search = pendingTotpUri
      ? `?totpURI=${encodeURIComponent(pendingTotpUri)}`
      : '';

    window.location.assign(`/two-factor${search}`);
  }

  async function handleCopyBackupCodes() {
    await navigator.clipboard.writeText(backupCodes.join('\n'));
    setDidCopyBackupCodes(true);
    showToast('Backup codes copied.', 'success');
    window.setTimeout(() => {
      setDidCopyBackupCodes(false);
    }, 2000);
  }

  const instructions = isTwoFactorEnabled
    ? 'Enter your password to disable 2FA.'
    : 'Enter your password to enable 2FA and finish setup with an authenticator app.';

  return (
    <>
      <Card className="w-full gap-0 overflow-hidden rounded-xl border border-border shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="font-semibold leading-none text-base md:text-base">
            Two-Factor
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Add an extra layer of security to your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 py-6">
          <p className="text-sm leading-6 text-muted-foreground text-left">{instructions}</p>
        </CardContent>
        <CardFooter className="border-t border-border bg-muted/20 px-6 py-4">
          <Button
            type="button"
            className="h-9 px-4"
            disabled={isPending}
            onClick={() => setIsDialogOpen(true)}
          >
            {isTwoFactorEnabled ? 'Disable Two-Factor' : 'Enable Two-Factor'}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Two-Factor</DialogTitle>
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
            <Button type="button" disabled={isSubmitting} onClick={isTwoFactorEnabled ? handleDisable : handleEnable}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {isTwoFactorEnabled ? 'Disable Two-Factor' : 'Enable Two-Factor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBackupCodesOpen} onOpenChange={setIsBackupCodesOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Backup Codes</DialogTitle>
            <DialogDescription>
              Save these backup codes in a secure place. You can use them to access your account
              if you lose your two-factor authentication method.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code) => (
              <div key={code} className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-center font-mono text-sm">
                {code}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCopyBackupCodes}>
              {didCopyBackupCodes ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              {didCopyBackupCodes ? 'Copied to clipboard' : 'Copy all codes'}
            </Button>
            <Button type="button" onClick={handleContinueToAuthenticator}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
