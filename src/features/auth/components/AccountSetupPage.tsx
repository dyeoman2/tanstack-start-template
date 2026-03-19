import { api } from '@convex/_generated/api';
import { Link, Navigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Badge } from '~/components/ui/badge';
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
import { authClient } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { getBetterAuthUserFacingMessage } from '~/features/auth/lib/better-auth-client-error';
import {
  getAccountSetupCallbackUrl,
  normalizeAppRedirectTarget,
} from '~/features/auth/lib/account-setup-routing';
import { useAuth } from '~/features/auth/hooks/useAuth';

function getEnrollmentErrorMessage(error: unknown) {
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

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}

type AccountSetupPageProps = {
  email?: string;
  redirectTo?: string;
  verified?: string;
};

export function AccountSetupPage({
  email: emailFromSearch,
  redirectTo,
  verified,
}: AccountSetupPageProps) {
  const router = useRouter();
  const { isAuthenticated, isPending, requiresEmailVerification, requiresMfaSetup, user } =
    useAuth();
  const emailServiceStatus = useQuery(api.emails.checkEmailServiceConfigured, {});
  const isEmailConfigured = emailServiceStatus?.isConfigured ?? true;
  const redirectTarget = normalizeAppRedirectTarget(redirectTo);
  const resolvedEmail = useMemo(
    () => user?.email ?? emailFromSearch ?? null,
    [emailFromSearch, user?.email],
  );
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(
    verified === 'success' ? 'Email verified. Finish securing your account to continue.' : null,
  );
  const [isResending, setIsResending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [isTwoFactorDialogOpen, setIsTwoFactorDialogOpen] = useState(false);
  const [isBackupCodesOpen, setIsBackupCodesOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingTotpUri, setPendingTotpUri] = useState<string | null>(null);
  const [isSubmittingTwoFactor, setIsSubmittingTwoFactor] = useState(false);

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated && !requiresEmailVerification && !requiresMfaSetup) {
    return <Navigate to={redirectTarget} replace />;
  }

  async function handleRefreshStatus() {
    setIsRefreshing(true);
    setError(null);

    try {
      await router.invalidate();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleResendVerificationEmail() {
    if (!isAuthenticated || !user?.email) {
      setError('Sign in to resend your verification email.');
      return;
    }

    setIsResending(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const callbackURL =
        typeof window === 'undefined'
          ? undefined
          : getAccountSetupCallbackUrl(window.location.origin, { redirectTo: redirectTarget });

      await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL,
        fetchOptions: { throw: true },
      });

      setSuccessMessage(`Verification email sent to ${user.email}.`);
    } catch (resendError) {
      setError(
        getBetterAuthUserFacingMessage(resendError, {
          fallback: 'Unable to send a verification email right now.',
        }),
      );
    } finally {
      setIsResending(false);
    }
  }

  async function handleAddPasskey() {
    setIsAddingPasskey(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await authClient.passkey.addPasskey({
        fetchOptions: { throw: true },
      });

      if (response?.error) {
        throw response.error;
      }

      setSuccessMessage('Passkey added. Finishing account setup…');
      await router.invalidate();
    } catch (passkeyError) {
      setError(
        getBetterAuthUserFacingMessage(passkeyError, {
          fallback: 'Unable to add a passkey right now.',
        }),
      );
    } finally {
      setIsAddingPasskey(false);
    }
  }

  async function handleEnableAuthenticator() {
    if (!password) {
      setError('Password is required to enable authenticator-based verification.');
      return;
    }

    setIsSubmittingTwoFactor(true);
    setError(null);

    try {
      const response = await authClient.twoFactor.enable({
        password,
        fetchOptions: { throw: true },
      });

      setPassword('');
      setPendingTotpUri(response.totpURI ?? null);
      setBackupCodes(response.backupCodes ?? []);
      setIsTwoFactorDialogOpen(false);
      setIsBackupCodesOpen(true);
    } catch (twoFactorError) {
      setError(getEnrollmentErrorMessage(twoFactorError));
    } finally {
      setIsSubmittingTwoFactor(false);
    }
  }

  function handleContinueToAuthenticator() {
    if (typeof window === 'undefined') {
      return;
    }

    const nextUrl = new URL('/two-factor', window.location.origin);

    if (redirectTarget !== '/app') {
      nextUrl.searchParams.set('redirectTo', redirectTarget);
    }

    if (pendingTotpUri) {
      nextUrl.searchParams.set('totpURI', pendingTotpUri);
    }

    window.location.assign(`${nextUrl.pathname}${nextUrl.search}`);
  }

  const emailStepComplete = isAuthenticated && !requiresEmailVerification;
  const securityStepComplete = isAuthenticated && !requiresMfaSetup;
  const completedStepCount = Number(emailStepComplete) + Number(securityStepComplete);
  const nextStepLabel = !isAuthenticated
    ? 'Sign in to continue setup'
    : !emailStepComplete
      ? 'Verify your email'
      : !securityStepComplete
        ? 'Add a passkey or authenticator'
        : 'Opening the app';

  return (
    <>
      <AuthRouteShell
        supplemental={
          <Card className="border-primary/15 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Finish account setup
              </CardTitle>
              <CardDescription>
                Create your account, verify your email, and add a passkey or authenticator before
                using the app.
              </CardDescription>
            </CardHeader>
          </Card>
        }
      >
        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold text-foreground">Complete your account setup</h1>
            <p className="text-sm text-muted-foreground">
              {resolvedEmail
                ? `Your setup progress is tied to ${resolvedEmail}.`
                : 'Sign in to continue setup and unlock the application.'}
            </p>
          </div>

          <Card className="border-border/70 bg-muted/20">
            <CardContent className="space-y-4 px-6 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {completedStepCount} of 2 required steps complete
                  </p>
                  <p className="text-sm text-muted-foreground">Next: {nextStepLabel}</p>
                </div>
                <Badge variant={completedStepCount === 2 ? 'success' : 'secondary'}>
                  {completedStepCount === 2 ? 'Ready' : 'Setup required'}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <StatusPill complete={emailStepComplete} label="Email verified" />
                <StatusPill complete={securityStepComplete} label="Account secured" />
              </div>
            </CardContent>
          </Card>

          {successMessage ? (
            <div className="rounded border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
              {successMessage}
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <StepCard
            description="Confirm your email address before accessing any protected part of the app."
            icon={<Mail className="h-5 w-5" />}
            title="Verify email"
            complete={emailStepComplete}
          >
            <p className="text-sm text-muted-foreground">
              {resolvedEmail
                ? `Verification emails are sent to ${resolvedEmail}.`
                : 'Sign in to see your verification status and resend the email if needed.'}
            </p>
            {!emailStepComplete && isAuthenticated ? (
              <p className="text-sm text-foreground">
                Use the link in your inbox, then return here. This page will pick up the updated
                status automatically.
              </p>
            ) : null}

            {!isEmailConfigured ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Email delivery is not configured in this environment. Set `RESEND_API_KEY` before
                requiring email verification here.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                onClick={() => void handleResendVerificationEmail()}
                disabled={
                  isResending ||
                  !isEmailConfigured ||
                  !isAuthenticated ||
                  !user?.email ||
                  emailStepComplete
                }
              >
                {isResending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Resend verification email
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRefreshStatus()}
                disabled={isRefreshing}
              >
                {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : null}
                Refresh status
              </Button>
            </div>
          </StepCard>

          <StepCard
            description="Secure the account with a passkey or authenticator app before app access is granted."
            icon={<KeyRound className="h-5 w-5" />}
            title="Secure your account"
            complete={securityStepComplete}
          >
            <p className="text-sm text-muted-foreground">
              Passkeys are recommended and satisfy the MFA requirement on their own.
            </p>
            {!emailStepComplete ? (
              <p className="text-sm text-muted-foreground">
                This step unlocks as soon as your email is verified.
              </p>
            ) : !securityStepComplete ? (
              <p className="text-sm text-foreground">
                Recommended: add a passkey for the fastest setup on this device.
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                onClick={() => void handleAddPasskey()}
                disabled={
                  !isAuthenticated || isAddingPasskey || !emailStepComplete || securityStepComplete
                }
              >
                {isAddingPasskey ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Add passkey
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setIsTwoFactorDialogOpen(true);
                }}
                disabled={!isAuthenticated || !emailStepComplete || securityStepComplete}
              >
                Use authenticator app instead
              </Button>
            </div>
          </StepCard>

          {!isAuthenticated ? (
            <div className="flex justify-center">
              <Button asChild>
                <Link
                  to="/login"
                  search={
                    resolvedEmail
                      ? {
                          email: resolvedEmail,
                          ...(redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {}),
                        }
                      : redirectTarget !== '/app'
                        ? { redirectTo: redirectTarget }
                        : {}
                  }
                >
                  Sign in to continue setup
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      </AuthRouteShell>

      <Dialog open={isTwoFactorDialogOpen} onOpenChange={setIsTwoFactorDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set up authenticator app</DialogTitle>
            <DialogDescription>
              Enter your password to start authenticator-based multi-factor setup.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label
              htmlFor="account-setup-two-factor-password"
              className="text-sm font-medium text-foreground"
            >
              Password
            </label>
            <Input
              id="account-setup-two-factor-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsTwoFactorDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleEnableAuthenticator()}
              disabled={isSubmittingTwoFactor}
            >
              {isSubmittingTwoFactor ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isBackupCodesOpen} onOpenChange={setIsBackupCodesOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Save your backup codes</DialogTitle>
            <DialogDescription>
              Keep these in a secure place. You can use them if you lose access to your
              authenticator.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            After this, you&apos;ll confirm the 6-digit code from your authenticator app to finish
            security setup.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code) => (
              <div
                key={code}
                className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-center font-mono text-sm"
              >
                {code}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleContinueToAuthenticator}>
              Continue to authenticator setup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusPill({ complete, label }: { complete: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
      <span className="text-sm text-foreground">{label}</span>
      <Badge variant={complete ? 'success' : 'outline'}>{complete ? 'Complete' : 'Required'}</Badge>
    </div>
  );
}

function StepCard({
  children,
  complete,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  complete: boolean;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Card className={complete ? 'border-primary/20 bg-primary/5' : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {icon}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div
            className={
              complete
                ? 'inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary'
                : 'inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground'
            }
          >
            {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
            {complete ? 'Complete' : 'Required'}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
