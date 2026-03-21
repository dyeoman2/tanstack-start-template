import { api } from '@convex/_generated/api';
import { Link, Navigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react';
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
import { cn } from '~/lib/utils';

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

type SetupStage = 'sign-in' | 'bridging' | 'verify-email' | 'secure-account';
type StepState = 'complete' | 'current' | 'upcoming';

type SetupViewModel = {
  hasSession: boolean;
  isAuthenticated: boolean;
  isEmailConfigured: boolean;
  emailStepComplete: boolean;
  securityStepComplete: boolean;
  completedStepCount: number;
  currentStage: SetupStage;
  currentStep: 1 | 2;
  title: string;
  subtitle: string;
  primaryCtaLabel: string | null;
  canResendEmail: boolean;
  canRefreshStatus: boolean;
  canAddPasskey: boolean;
  canAddAuthenticator: boolean;
  isAwaitingSignInAfterVerification: boolean;
};

function getSetupViewModel(input: {
  hasSession: boolean;
  isAuthenticated: boolean;
  isEmailConfigured: boolean;
  isEmailVerifiedFromCallback: boolean;
  requiresEmailVerification: boolean;
  requiresMfaSetup: boolean;
  resolvedEmail: string | null;
}) {
  const emailStepComplete =
    input.isEmailVerifiedFromCallback ||
    (input.isAuthenticated && !input.requiresEmailVerification);
  const securityStepComplete = input.isAuthenticated && !input.requiresMfaSetup;
  const completedStepCount = Number(emailStepComplete) + Number(securityStepComplete);
  const isAwaitingSignInAfterVerification = emailStepComplete && !input.isAuthenticated;

  let currentStage: SetupStage;
  if (!input.hasSession) {
    currentStage = 'sign-in';
  } else if (!input.isAuthenticated) {
    currentStage = 'bridging';
  } else if (!emailStepComplete) {
    currentStage = 'verify-email';
  } else {
    currentStage = 'secure-account';
  }

  const viewModel: SetupViewModel = {
    hasSession: input.hasSession,
    isAuthenticated: input.isAuthenticated,
    isEmailConfigured: input.isEmailConfigured,
    emailStepComplete,
    securityStepComplete,
    completedStepCount,
    currentStage,
    currentStep:
      currentStage === 'secure-account' || (currentStage === 'sign-in' && emailStepComplete)
        ? 2
        : 1,
    title: 'Complete your account setup',
    subtitle: '',
    primaryCtaLabel: null,
    canResendEmail: !emailStepComplete && !!input.resolvedEmail && input.isEmailConfigured,
    canRefreshStatus: currentStage === 'verify-email' || currentStage === 'bridging',
    canAddPasskey: input.isAuthenticated && emailStepComplete && !securityStepComplete,
    canAddAuthenticator: input.isAuthenticated && emailStepComplete && !securityStepComplete,
    isAwaitingSignInAfterVerification,
  };

  switch (currentStage) {
    case 'sign-in':
      if (emailStepComplete) {
        viewModel.subtitle = input.resolvedEmail
          ? `${input.resolvedEmail} is verified. Sign in to continue securing your account.`
          : 'Your email is verified. Sign in to continue securing your account.';
        viewModel.primaryCtaLabel = 'Sign in to continue';
      } else {
        viewModel.subtitle = input.resolvedEmail
          ? `Verify ${input.resolvedEmail} to continue setup.`
          : 'Verify your email to continue setup.';
      }
      break;
    case 'bridging':
      viewModel.subtitle = input.resolvedEmail
        ? `We found a session for ${input.resolvedEmail}. Finishing account status checks now.`
        : 'Finishing account status checks now.';
      break;
    case 'verify-email':
      viewModel.subtitle = input.resolvedEmail
        ? `Verify ${input.resolvedEmail} to continue into the app.`
        : 'Verify your email to continue into the app.';
      viewModel.primaryCtaLabel = viewModel.canResendEmail ? 'Resend verification email' : null;
      break;
    case 'secure-account':
      viewModel.subtitle = input.resolvedEmail
        ? `${input.resolvedEmail} is verified. Add a passkey or authenticator to finish setup.`
        : 'Add a passkey or authenticator to finish setup.';
      viewModel.primaryCtaLabel = 'Add passkey';
      break;
  }

  return viewModel;
}

export function AccountSetupPage({
  email: emailFromSearch,
  redirectTo,
  verified,
}: AccountSetupPageProps) {
  const router = useRouter();
  const {
    hasSession,
    isAuthenticated,
    isPending,
    requiresEmailVerification,
    requiresMfaSetup,
    user,
  } = useAuth();
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

  const viewModel = getSetupViewModel({
    hasSession,
    isAuthenticated,
    isEmailConfigured,
    isEmailVerifiedFromCallback: verified === 'success',
    requiresEmailVerification,
    requiresMfaSetup,
    resolvedEmail,
  });

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
    const targetEmail = user?.email ?? resolvedEmail;
    if (!targetEmail) {
      setError('Enter or recover your email address before requesting verification.');
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
        email: targetEmail,
        callbackURL,
        fetchOptions: { throw: true },
      });

      setSuccessMessage(`Verification email sent to ${targetEmail}.`);
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

  const stepOneState: StepState = viewModel.emailStepComplete
    ? 'complete'
    : viewModel.currentStep === 1
      ? 'current'
      : 'upcoming';
  const stepTwoState: StepState = viewModel.securityStepComplete
    ? 'complete'
    : viewModel.currentStep === 2
      ? 'current'
      : 'upcoming';

  return (
    <>
      <AuthRouteShell>
        <Card className="w-full border-border/70">
          <CardHeader className="space-y-5">
            <div className="space-y-2">
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] uppercase">
                Account setup
              </Badge>
              <CardTitle className="text-3xl font-normal tracking-tight">
                {viewModel.title}
              </CardTitle>
              <CardDescription className="max-w-sm text-sm leading-6">
                {viewModel.subtitle}
              </CardDescription>
            </div>

            <div className="grid gap-3">
              <ProgressStep
                step={1}
                title="Verify email"
                detail={
                  viewModel.emailStepComplete
                    ? 'Complete'
                    : viewModel.currentStep === 1
                      ? 'Current step'
                      : 'Up next'
                }
                state={stepOneState}
              />
              <ProgressStep
                step={2}
                title="Secure account"
                detail={
                  viewModel.securityStepComplete
                    ? 'Complete'
                    : viewModel.isAwaitingSignInAfterVerification
                      ? 'Next step after sign-in'
                      : viewModel.currentStep === 2
                        ? 'Current step'
                        : 'Locked until email is verified'
                }
                state={viewModel.isAwaitingSignInAfterVerification ? 'upcoming' : stepTwoState}
              />
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {successMessage && !viewModel.isAwaitingSignInAfterVerification ? (
              <Notice tone="success">{successMessage}</Notice>
            ) : null}

            {error ? <Notice tone="error">{error}</Notice> : null}

            {viewModel.isAwaitingSignInAfterVerification ? (
              <Notice tone="success">
                Email verified. Sign in to continue to the final security step.
              </Notice>
            ) : null}

            {viewModel.currentStage === 'bridging' ? (
              <Notice tone="neutral">
                You are signed in. We&apos;re still confirming your account requirements before we
                unlock the next step.
              </Notice>
            ) : null}

            <SetupStepCard
              title="Verify email"
              description="Confirm your email address before accessing any protected part of the app."
              icon={<Mail className="h-5 w-5" />}
              state={stepOneState}
            >
              {stepOneState === 'complete' ? (
                <StepSummary>
                  <p className="text-foreground">Email verified.</p>
                  <p>Your account can now continue to security setup.</p>
                </StepSummary>
              ) : viewModel.currentStage === 'sign-in' ? (
                <>
                  <StepSummary>
                    <p className="text-foreground">
                      {resolvedEmail
                        ? `Use the verification link sent to ${resolvedEmail}.`
                        : 'Use the verification link from your inbox to continue.'}
                    </p>
                    <p>
                      You can verify first, then return here to sign in and finish securing the
                      account.
                    </p>
                  </StepSummary>

                  {!viewModel.isEmailConfigured ? (
                    <Notice tone="warning">
                      Email delivery is not configured in this environment. Set `RESEND_API_KEY`
                      before requiring email verification here.
                    </Notice>
                  ) : null}

                  {viewModel.canResendEmail ? (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button
                        type="button"
                        className="w-full sm:w-full"
                        onClick={() => void handleResendVerificationEmail()}
                      >
                        {isResending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Mail className="size-4" />
                        )}
                        {isResending ? 'Sending email' : 'Resend verification email'}
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : viewModel.currentStage === 'bridging' ? (
                <StepSummary>
                  <p className="text-foreground">Checking your verification status.</p>
                  <p>This page will update as soon as your account status loads.</p>
                </StepSummary>
              ) : (
                <>
                  <StepSummary>
                    <p className="text-foreground">
                      {resolvedEmail
                        ? `Verification emails are sent to ${resolvedEmail}.`
                        : 'Use the link in your inbox, then return here.'}
                    </p>
                    <p>
                      Open the email link, then return here. Refresh if this page does not update on
                      its own.
                    </p>
                  </StepSummary>

                  {!viewModel.isEmailConfigured ? (
                    <Notice tone="warning">
                      Email delivery is not configured in this environment. Set `RESEND_API_KEY`
                      before requiring email verification here.
                    </Notice>
                  ) : null}

                  <div className="flex flex-col gap-3 sm:flex-row">
                    {viewModel.canResendEmail ? (
                      <Button type="button" onClick={() => void handleResendVerificationEmail()}>
                        {isResending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Mail className="size-4" />
                        )}
                        {isResending ? 'Sending email' : 'Resend verification email'}
                      </Button>
                    ) : null}
                    {viewModel.canRefreshStatus ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleRefreshStatus()}
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : null}
                        Refresh status
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </SetupStepCard>

            <SetupStepCard
              title="Secure your account"
              description="Add a passkey or authenticator app before app access is granted."
              icon={<KeyRound className="h-5 w-5" />}
              state={stepTwoState}
            >
              {stepTwoState === 'complete' ? (
                <StepSummary>
                  <p className="text-foreground">Account security complete.</p>
                  <p>You&apos;re ready to continue into the app.</p>
                </StepSummary>
              ) : viewModel.currentStage === 'sign-in' && viewModel.emailStepComplete ? (
                <StepSummary>
                  <p className="text-foreground">Next step starts after you sign in.</p>
                  <p>Sign in again to add a passkey or authenticator and finish setup.</p>
                </StepSummary>
              ) : stepTwoState === 'upcoming' ? (
                <StepSummary>
                  <p className="text-foreground">Locked until email is verified.</p>
                  <p>
                    Finish the email step first. Passkeys will then become available immediately.
                  </p>
                </StepSummary>
              ) : (
                <>
                  <StepSummary>
                    <p className="text-foreground">
                      Add a passkey for the fastest setup on this device.
                    </p>
                    <p>Authenticator apps remain available if you prefer not to use a passkey.</p>
                  </StepSummary>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    {viewModel.canAddPasskey ? (
                      <Button type="button" onClick={() => void handleAddPasskey()}>
                        {isAddingPasskey ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="size-4" />
                        )}
                        {isAddingPasskey ? 'Adding passkey' : 'Add passkey'}
                      </Button>
                    ) : null}
                    {viewModel.canAddAuthenticator ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setError(null);
                          setIsTwoFactorDialogOpen(true);
                        }}
                      >
                        Use authenticator app instead
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </SetupStepCard>

            <div className="flex justify-between gap-3 border-t border-border/70 pt-4">
              <div className="space-y-1 text-sm text-muted-foreground">
                <p className="text-foreground">
                  {viewModel.completedStepCount} of 2 required steps complete
                </p>
                <p>
                  {viewModel.currentStage === 'sign-in'
                    ? viewModel.emailStepComplete
                      ? 'Email is verified. Sign in again to finish the final security step.'
                      : 'Verify your email first, then sign in and secure the account.'
                    : viewModel.currentStage === 'bridging'
                      ? 'Waiting for account status to finish loading.'
                      : viewModel.currentStage === 'verify-email'
                        ? 'Finish email verification to unlock the final security step.'
                        : 'Add a passkey or authenticator to finish setup.'}
                </p>
              </div>

              {viewModel.currentStage === 'sign-in' && viewModel.emailStepComplete ? (
                <Button asChild className="shrink-0">
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
                    Sign in to continue
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
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
            <label htmlFor="account-setup-two-factor-password" className="text-sm text-foreground">
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

function ProgressStep({
  step,
  title,
  detail,
  state,
}: {
  step: 1 | 2;
  title: string;
  detail: string;
  state: StepState;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-4 py-3',
        state === 'current' && 'border-primary/30 bg-background',
        state === 'complete' && 'border-border/70 bg-background',
        state === 'upcoming' && 'border-border/70 bg-background',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full border text-sm',
          state === 'current' && 'border-primary bg-primary/10 text-primary',
          state === 'complete' && 'border-primary/20 bg-primary/5 text-primary',
          state === 'upcoming' && 'border-border bg-background text-muted-foreground',
        )}
      >
        {state === 'complete' ? <CheckCircle2 className="h-4 w-4" /> : step}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {state === 'current' ? <ChevronRight className="h-4 w-4 text-primary" /> : null}
    </div>
  );
}

function SetupStepCard({
  children,
  description,
  icon,
  state,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  state: StepState;
  title: string;
}) {
  const badgeLabel =
    state === 'complete' ? 'Complete' : state === 'current' ? 'Current step' : 'Locked';

  return (
    <section
      className={cn(
        'rounded-2xl border p-5 transition-colors',
        state === 'current' && 'border-primary/25 bg-background',
        state === 'complete' && 'border-border/70 bg-background',
        state === 'upcoming' && 'border-border/70 bg-muted/20',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'rounded-full p-2',
                state === 'current' && 'bg-primary/10 text-primary',
                state === 'complete' && 'bg-primary/5 text-primary',
                state === 'upcoming' && 'bg-background text-muted-foreground',
              )}
            >
              {icon}
            </div>
            <div>
              <h2 className="text-lg text-foreground">{title}</h2>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>

        <Badge
          variant={state === 'complete' ? 'success' : state === 'current' ? 'secondary' : 'outline'}
          className="shrink-0 rounded-full px-3 py-1"
        >
          {state === 'upcoming' ? <LockKeyhole className="h-3.5 w-3.5" /> : null}
          {badgeLabel}
        </Badge>
      </div>

      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function StepSummary({ children }: { children: ReactNode }) {
  return <div className="space-y-1 text-sm text-muted-foreground">{children}</div>;
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'neutral' | 'success' | 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3 text-sm',
        tone === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
        tone === 'neutral' && 'border-border/70 bg-muted/30 text-foreground',
        tone === 'success' && 'border-primary/20 bg-primary/10 text-primary',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      {children}
    </div>
  );
}
