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
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import { authClient, signOut } from '~/features/auth/auth-client';
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

type SetupStage = 'bridging' | 'secure-account' | 'verified-awaiting-sign-in' | 'verify-email';
type StepState = 'complete' | 'current' | 'upcoming';

type SetupViewModel = {
  emailStepComplete: boolean;
  securityStepComplete: boolean;
  completedStepCount: number;
  currentStage: SetupStage;
  currentStep: 1 | 2;
  title: string;
  rationale: string;
  subtitle: string;
  canResendEmail: boolean;
  canCheckVerification: boolean;
  canAddPasskey: boolean;
  canAddAuthenticator: boolean;
  canPollStatus: boolean;
  canUseDifferentEmail: boolean;
  isAwaitingSignInAfterVerification: boolean;
};

const STATUS_POLL_INTERVAL_MS = 5000;
const RESEND_COOLDOWN_SECONDS = 30;

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
  if (input.hasSession && !input.isAuthenticated) {
    currentStage = 'bridging';
  } else if (!emailStepComplete) {
    currentStage = 'verify-email';
  } else if (!input.isAuthenticated) {
    currentStage = 'verified-awaiting-sign-in';
  } else {
    currentStage = 'secure-account';
  }

  const viewModel: SetupViewModel = {
    emailStepComplete,
    securityStepComplete,
    completedStepCount,
    currentStage,
    currentStep:
      currentStage === 'secure-account' || currentStage === 'verified-awaiting-sign-in' ? 2 : 1,
    title: 'Complete your account setup',
    rationale:
      'To protect workspace access, we require a verified email and a strong second sign-in method before granting app access.',
    subtitle: '',
    canResendEmail: !emailStepComplete && !!input.resolvedEmail && input.isEmailConfigured,
    canCheckVerification: currentStage === 'verify-email' || currentStage === 'bridging',
    canAddPasskey: input.isAuthenticated && emailStepComplete && !securityStepComplete,
    canAddAuthenticator: input.isAuthenticated && emailStepComplete && !securityStepComplete,
    canPollStatus: currentStage === 'verify-email' || currentStage === 'bridging',
    canUseDifferentEmail:
      currentStage === 'verify-email' || currentStage === 'verified-awaiting-sign-in',
    isAwaitingSignInAfterVerification,
  };

  switch (currentStage) {
    case 'bridging':
      viewModel.subtitle = input.resolvedEmail
        ? `Checking whether ${input.resolvedEmail} has completed the verification step.`
        : 'Checking whether your verification step is complete.';
      break;
    case 'verify-email':
      viewModel.subtitle = input.resolvedEmail
        ? `Verify ${input.resolvedEmail} to continue to passkey or authenticator setup.`
        : 'Verify your email to continue to passkey or authenticator setup.';
      break;
    case 'verified-awaiting-sign-in':
      viewModel.subtitle = input.resolvedEmail
        ? `${input.resolvedEmail} is verified. Sign in to add your passkey or authenticator.`
        : 'Your email is verified. Sign in to add your passkey or authenticator.';
      break;
    case 'secure-account':
      viewModel.subtitle = input.resolvedEmail
        ? `${input.resolvedEmail} is verified. Add a passkey or authenticator to finish setup.`
        : 'Add a passkey or authenticator to finish setup.';
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
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [isTwoFactorDialogOpen, setIsTwoFactorDialogOpen] = useState(false);
  const [isBackupCodesOpen, setIsBackupCodesOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pendingTotpUri, setPendingTotpUri] = useState<string | null>(null);
  const [isSubmittingTwoFactor, setIsSubmittingTwoFactor] = useState(false);
  const isBackgroundRefreshInFlightRef = useRef(false);

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

  useEffect(() => {
    if (resendCooldownSeconds <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setResendCooldownSeconds((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [resendCooldownSeconds]);

  async function runStatusCheck(background: boolean) {
    if (background) {
      if (isBackgroundRefreshInFlightRef.current) {
        return;
      }

      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      isBackgroundRefreshInFlightRef.current = true;
    } else {
      setIsRefreshing(true);
      setError(null);
    }

    try {
      await router.invalidate();
    } finally {
      if (background) {
        isBackgroundRefreshInFlightRef.current = false;
      } else {
        setIsRefreshing(false);
      }
    }
  }

  useEffect(() => {
    if (!viewModel.canPollStatus) {
      return;
    }

    if (viewModel.currentStage === 'bridging') {
      void runStatusCheck(true);
    }

    const intervalId = window.setInterval(() => {
      void runStatusCheck(true);
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      isBackgroundRefreshInFlightRef.current = false;
    };
  }, [viewModel.canPollStatus, viewModel.currentStage, router]);

  async function handleRefreshStatus() {
    await runStatusCheck(false);
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
      setResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
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

  async function handleUseDifferentEmail() {
    setError(null);
    setSuccessMessage(null);

    if (hasSession) {
      try {
        await signOut();
      } catch {
        // Best effort: continue to login so the user can recover with another account.
      }
    }

    await router.invalidate();
    await router.navigate({
      to: '/login',
      search: redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {},
      replace: true,
    });
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
              <CardDescription className="text-sm leading-6 text-foreground">
                {viewModel.rationale}
              </CardDescription>
              <CardDescription className="max-w-md text-sm leading-6">
                {viewModel.subtitle}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {successMessage ? <Notice tone="success">{successMessage}</Notice> : null}

            {error ? <Notice tone="error">{error}</Notice> : null}

            <div className="grid gap-3">
              <ProgressAccordionStep
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
              >
                {viewModel.currentStep === 1 ? (
                  viewModel.currentStage === 'bridging' ? (
                    <>
                      <StepSummary>
                        <p className="text-foreground">Checking your verification status.</p>
                        <p>We&apos;ll keep checking automatically, or you can confirm below.</p>
                      </StepSummary>

                      <div className="flex flex-col gap-3">
                        {viewModel.canCheckVerification ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => void handleRefreshStatus()}
                            disabled={isRefreshing}
                          >
                            {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : null}
                            I&apos;ve verified my email
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <StepSummary>
                        <p className="text-foreground">
                          Check your inbox for the verification link.
                        </p>
                        <p>We&apos;ll keep checking automatically, or you can confirm below.</p>
                      </StepSummary>

                      {!isEmailConfigured ? (
                        <Notice tone="warning">
                          Email delivery is not configured in this environment. Set `RESEND_API_KEY`
                          before requiring email verification here.
                        </Notice>
                      ) : null}

                      <div className="flex flex-col gap-3">
                        {viewModel.canCheckVerification ? (
                          <Button
                            type="button"
                            className="w-full"
                            onClick={() => void handleRefreshStatus()}
                            disabled={isRefreshing}
                          >
                            {isRefreshing ? <Loader2 className="size-4 animate-spin" /> : null}
                            I&apos;ve verified my email
                          </Button>
                        ) : null}
                        {viewModel.canResendEmail ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => void handleResendVerificationEmail()}
                            disabled={isResending || resendCooldownSeconds > 0}
                          >
                            {isResending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Mail className="size-4" />
                            )}
                            {isResending
                              ? 'Sending email'
                              : resendCooldownSeconds > 0
                                ? `Resend in ${resendCooldownSeconds}s`
                                : 'Resend verification email'}
                          </Button>
                        ) : null}
                      </div>

                      {viewModel.canUseDifferentEmail ? (
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto justify-start px-0 text-[11px] font-normal text-muted-foreground/80 hover:text-muted-foreground"
                          onClick={() => void handleUseDifferentEmail()}
                        >
                          Wrong email? Use another account
                        </Button>
                      ) : null}
                    </>
                  )
                ) : stepOneState === 'complete' ? (
                  <StepSummary>
                    <p className="text-foreground">Email verified.</p>
                    <p>You can now continue to the strong sign-in setup step.</p>
                  </StepSummary>
                ) : null}
              </ProgressAccordionStep>

              <ProgressAccordionStep
                step={2}
                title="Add a passkey or authenticator"
                detail={
                  viewModel.securityStepComplete
                    ? 'Complete'
                    : viewModel.isAwaitingSignInAfterVerification
                      ? 'Current step'
                      : viewModel.currentStep === 2
                        ? 'Current step'
                        : 'Locked until email is verified'
                }
                state={viewModel.isAwaitingSignInAfterVerification ? 'current' : stepTwoState}
              >
                {viewModel.currentStage === 'verified-awaiting-sign-in' ? (
                  <>
                    <StepSummary>
                      <p className="text-foreground">
                        {resolvedEmail
                          ? `${resolvedEmail} is verified.`
                          : 'Your email is verified.'}
                      </p>
                      <p>Sign in again to continue to passkey or authenticator setup.</p>
                    </StepSummary>

                    <Button asChild className="w-full">
                      <Link
                        to="/login"
                        search={
                          resolvedEmail
                            ? {
                                email: resolvedEmail,
                                ...(redirectTarget !== '/app'
                                  ? { redirectTo: redirectTarget }
                                  : {}),
                              }
                            : redirectTarget !== '/app'
                              ? { redirectTo: redirectTarget }
                              : {}
                        }
                      >
                        Sign in to continue
                      </Link>
                    </Button>
                  </>
                ) : stepTwoState === 'current' ? (
                  <>
                    <StepSummary>
                      <p className="text-foreground">
                        Add a passkey for the strongest and fastest setup on this device.
                      </p>
                      <p>Authenticator apps remain available as a supported fallback.</p>
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
                ) : null}
              </ProgressAccordionStep>
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

function ProgressAccordionStep({
  children,
  step,
  title,
  detail,
  state,
}: {
  children?: ReactNode;
  step: 1 | 2;
  title: string;
  detail: string;
  state: StepState;
}) {
  const badgeLabel =
    state === 'complete' ? 'Complete' : state === 'current' ? 'Current step' : 'Locked';
  const isExpanded = state === 'current';

  return (
    <section
      className={cn(
        'rounded-2xl border transition-colors',
        state === 'current' && 'border-primary/30 bg-background',
        state === 'complete' && 'border-border/70 bg-background',
        state === 'upcoming' && 'border-border/70 bg-background',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-4">
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
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <Badge variant="secondary" className="shrink-0 rounded-full px-3 py-1">
              {badgeLabel}
            </Badge>
          ) : null}
          {state === 'upcoming' ? (
            <Badge variant="outline" className="shrink-0 rounded-full px-3 py-1">
              <LockKeyhole className="h-3.5 w-3.5" />
              {badgeLabel}
            </Badge>
          ) : null}
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              state === 'current' && 'rotate-90 text-primary',
            )}
          />
        </div>
      </div>

      {isExpanded ? (
        <div className="space-y-4 border-t border-border/70 px-4 py-5">{children}</div>
      ) : null}
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
