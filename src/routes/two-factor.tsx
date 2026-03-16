import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { CheckIcon, CopyIcon, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Checkbox } from '~/components/ui/checkbox';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { authClient, useSession } from '~/features/auth/auth-client';
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

function formatSetupKey(setupKey: string) {
  return setupKey.match(/.{1,4}/g)?.join('-') ?? setupKey;
}

function getTotpMetadata(totpUri?: string) {
  if (!totpUri) {
    return null;
  }

  try {
    const parsed = new URL(totpUri);
    const label = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const issuer = parsed.searchParams.get('issuer');
    const [accountIssuer, accountName] = label.includes(':') ? label.split(':', 2) : [null, label];

    return {
      accountName,
      issuer: issuer ?? accountIssuer,
    };
  } catch {
    return null;
  }
}

function TwoFactorPage() {
  const { redirectTo, totpURI } = Route.useSearch();
  const router = useRouter();
  const { showToast } = useToast();
  const { data: sessionData } = useSession();
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didCopySetupKey, setDidCopySetupKey] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [showManualSetupKey, setShowManualSetupKey] = useState(false);

  const setupKey = useMemo(() => getManualEntryCode(totpURI), [totpURI]);
  const formattedSetupKey = useMemo(() => (setupKey ? formatSetupKey(setupKey) : null), [setupKey]);
  const totpMetadata = useMemo(() => getTotpMetadata(totpURI), [totpURI]);
  const accountEmail =
    (sessionData?.user as { email?: string } | undefined)?.email ??
    totpMetadata?.accountName ??
    null;

  useEffect(() => {
    let cancelled = false;

    async function generateQrCode() {
      if (!totpURI) {
        setQrCodeDataUrl(null);
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(totpURI, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 220,
        });

        if (!cancelled) {
          setQrCodeDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrCodeDataUrl(null);
        }
      }
    }

    void generateQrCode();

    return () => {
      cancelled = true;
    };
  }, [totpURI]);

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
    setDidCopySetupKey(true);
    window.setTimeout(() => {
      setDidCopySetupKey(false);
    }, 2000);
  }

  return (
    <AuthRouteShell>
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-3xl">Two-Factor</CardTitle>
          <CardDescription>
            {totpURI
              ? 'Scan this QR code with your authenticator app, then enter the 6-digit code to finish setup.'
              : 'Please enter your one-time password to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {setupKey ? (
            <div className="space-y-4 rounded-lg border border-border/70 bg-muted/10 p-6">
              {qrCodeDataUrl ? (
                <div className="flex justify-center">
                  <img
                    src={qrCodeDataUrl}
                    alt="Authenticator QR code"
                    className="rounded-md border border-border bg-white p-2"
                    width={220}
                    height={220}
                  />
                </div>
              ) : null}
              {totpMetadata?.issuer || accountEmail ? (
                <p className="text-center text-sm text-muted-foreground">
                  {totpMetadata?.issuer ? `${totpMetadata.issuer}` : null}
                  {totpMetadata?.issuer && accountEmail ? ' · ' : null}
                  {accountEmail}
                </p>
              ) : null}
              <div className="text-center">
                <button
                  type="button"
                  className="text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
                  onClick={() => setShowManualSetupKey((current) => !current)}
                >
                  {showManualSetupKey ? 'Hide setup key' : "Can't scan the code?"}
                </button>
              </div>
              {showManualSetupKey ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Enter this setup key manually in Google Authenticator, 1Password, or another
                    TOTP app.
                  </p>
                  <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
                    <div className="min-w-0 flex-1 overflow-x-auto font-mono text-sm">
                      {formattedSetupKey}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopySetupKey}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={didCopySetupKey ? 'Setup key copied' : 'Copy setup key'}
                      title={didCopySetupKey ? 'Copied' : 'Copy setup key'}
                    >
                      {didCopySetupKey ? (
                        <CheckIcon className="size-4" />
                      ) : (
                        <CopyIcon className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              ) : null}
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
                  search={{
                    ...(redirectTo ? { redirectTo } : {}),
                    ...(totpURI ? { totpURI } : {}),
                  }}
                  className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Use a backup code
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

            {!totpURI ? (
              <label className="flex items-center gap-3 text-sm font-medium text-foreground">
                <Checkbox
                  checked={trustDevice}
                  onCheckedChange={(checked) => setTrustDevice(checked === true)}
                />
                Trust this device
              </label>
            ) : null}

            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {totpURI ? 'Verify and enable' : 'Verify code'}
            </Button>
          </form>

          <div className="text-center">
            <Link
              to="/app/profile"
              className="text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
            >
              Back to profile
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthRouteShell>
  );
}
