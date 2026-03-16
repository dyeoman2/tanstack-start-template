import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Checkbox } from '~/components/ui/checkbox';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';

export const Route = createFileRoute('/two-factor')({
  staticData: true,
  component: TwoFactorPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    redirectTo: z.string().optional(),
    totpURI: z.string().optional(),
  }),
});

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

  return 'Unable to verify code. Please try again.';
}

function getManualEntryCode(totpUri?: string) {
  if (!totpUri) {
    return null;
  }

  try {
    const parsed = new URL(totpUri);
    return parsed.searchParams.get('secret');
  } catch {
    return null;
  }
}

function TwoFactorPage() {
  const { redirectTo, totpURI } = Route.useSearch();
  const router = useRouter();
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setupKey = useMemo(() => getManualEntryCode(totpURI), [totpURI]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (code.trim().length < 6) {
      showToast('Enter the 6-digit code from your authenticator app.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      await authClient.twoFactor.verifyTotp({
        code: code.trim(),
        trustDevice,
        fetchOptions: { throw: true },
      });

      await router.invalidate();
      await router.navigate({ to: redirectTo || '/app', replace: true });
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopySetupKey() {
    if (!setupKey) {
      return;
    }

    await navigator.clipboard.writeText(setupKey);
    showToast('Setup key copied.', 'success');
  }

  return (
    <AuthRouteShell>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl">Two-Factor</CardTitle>
          <CardDescription>
            {totpURI
              ? 'Open your authenticator app, add this account, then enter the current 6-digit code.'
              : 'Please enter your one-time password to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {setupKey ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Authenticator setup key</p>
                <p className="text-sm text-muted-foreground">
                  If the QR code is unavailable, paste this key into your authenticator app.
                </p>
              </div>
              <div className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
                {setupKey}
              </div>
              <Button type="button" variant="outline" onClick={handleCopySetupKey}>
                Copy setup key
              </Button>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="two-factor-code" className="text-sm font-medium text-foreground">
                  One-Time Password
                </label>
                <Link
                  to="/recover-account"
                  search={redirectTo ? { redirectTo } : {}}
                  className="text-sm font-medium hover:text-muted-foreground"
                >
                  Forgot authenticator?
                </Link>
              </div>
              <Input
                id="two-factor-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
            </div>

            <label className="flex items-center gap-3 text-sm font-medium text-foreground">
              <Checkbox
                checked={trustDevice}
                onCheckedChange={(checked) => setTrustDevice(checked === true)}
              />
              Trust this device
            </label>

            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Verify code
            </Button>
          </form>

          <div className="text-center">
            <button
              type="button"
              className="text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
              onClick={() => window.history.back()}
            >
              Go back
            </button>
          </div>
        </CardContent>
      </Card>
    </AuthRouteShell>
  );
}
