import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { authClient, refreshAuthClientSession, signOut } from '~/features/auth/auth-client';
import { BackupCodesDialog } from '~/features/auth/components/BackupCodesDialog';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { useAuth } from '~/features/auth/hooks/useAuth';
import {
  getAccountSetupCallbackUrl,
  normalizeAppRedirectTarget,
} from '~/features/auth/lib/account-setup-routing';
import { getBetterAuthUserFacingMessage } from '~/features/auth/lib/better-auth-client-error';
import { beginAuthenticatorOnboardingServerFn } from '~/features/auth/server/onboarding';
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

function isSessionNotFreshError(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string' && record.code === 'SESSION_NOT_FRESH') {
      return true;
    }

    const nestedError = record.error;
    if (typeof nestedError === 'object' && nestedError !== null) {
      const nestedRecord = nestedError as Record<string, unknown>;
      if (typeof nestedRecord.code === 'string' && nestedRecord.code === 'SESSION_NOT_FRESH') {
        return true;
      }

      if (
        typeof nestedRecord.message === 'string' &&
        nestedRecord.message.toUpperCase().includes('SESSION_NOT_FRESH')
      ) {
        return true;
      }
    }

    if (
      typeof record.message === 'string' &&
      record.message.toUpperCase().includes('SESSION_NOT_FRESH')
    ) {
      return true;
    }
  }

  return false;
}

type AccountSetupPageProps = {
  email?: string;
  redirectTo?: string;
  verified?: string;
};

type SetupStage = 'bridging' | 'secure-account' | 'verified-awaiting-sign-in' | 'verify-email';
type StepState = 'complete' | 'current' | 'upcoming';
type SessionContinuationState = 'idle' | 'checking' | 'failed' | 'verified';

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
const SESSION_CONTINUATION_RETRY_DELAY_MS = 800;
const SESSION_CONTINUATION_MAX_ATTEMPTS = 3;

function getSetupViewModel(input: {
  isAuthenticated: boolean;
  isEmailConfigured: boolean;
  hasVerificationCallback: boolean;
  hasVerifiedEmailInSession: boolean;
  requiresEmailVerification: boolean;
  requiresMfaSetup: boolean;
  resolvedEmail: string | null;
  sessionContinuationState: SessionContinuationState;
}) {
  const hasRecoveredVerifiedSession = input.sessionContinuationState === 'verified';
  const sessionRecoveryFailed = input.sessionContinuationState === 'failed';
  const emailStepComplete =
    hasRecoveredVerifiedSession ||
    input.hasVerifiedEmailInSession ||
    (input.isAuthenticated && !input.requiresEmailVerification);
  const securityStepComplete = input.isAuthenticated && !input.requiresMfaSetup;
  const completedStepCount = Number(emailStepComplete) + Number(securityStepComplete);
  const isAwaitingSignInAfterVerification =
    emailStepComplete && !input.isAuthenticated && sessionRecoveryFailed;
  const canContinueStrongAuthSetup =
    emailStepComplete &&
    (input.isAuthenticated || hasRecoveredVerifiedSession || input.hasVerifiedEmailInSession);

  let currentStage: SetupStage;
  if (canContinueStrongAuthSetup) {
    currentStage = 'secure-account';
  } else if (sessionRecoveryFailed && input.hasVerificationCallback) {
    currentStage = 'verified-awaiting-sign-in';
  } else if (emailStepComplete && !input.isAuthenticated) {
    currentStage = sessionRecoveryFailed ? 'verified-awaiting-sign-in' : 'bridging';
  } else if (input.hasVerificationCallback) {
    currentStage = 'bridging';
  } else {
    currentStage = emailStepComplete ? 'secure-account' : 'verify-email';
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
      'We require a verified email and multi-factor authentication before granting app access.',
    subtitle: '',
    canResendEmail: !emailStepComplete && !!input.resolvedEmail && input.isEmailConfigured,
    canCheckVerification: currentStage === 'verify-email' || currentStage === 'bridging',
    canAddPasskey: emailStepComplete && !securityStepComplete && !sessionRecoveryFailed,
    canAddAuthenticator: emailStepComplete && !securityStepComplete && !sessionRecoveryFailed,
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
      viewModel.subtitle = '';
      break;
    case 'verified-awaiting-sign-in':
      viewModel.subtitle = input.resolvedEmail
        ? `${input.resolvedEmail} is verified. Sign in to set up MFA.`
        : 'Your email is verified. Sign in to set up MFA.';
      break;
    case 'secure-account':
      viewModel.subtitle = '';
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
  const queryClient = useQueryClient();
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
  const hasVerificationCallback = verified === 'success';
  const hasVerifiedEmailInSession = user?.emailVerified === true;
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);
  const [needsFreshSignInForPasskey, setNeedsFreshSignInForPasskey] = useState(false);
  const [isBackupCodesOpen, setIsBackupCodesOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isContinuingToAuthenticator, setIsContinuingToAuthenticator] = useState(false);
  const [pendingTotpUri, setPendingTotpUri] = useState<string | null>(null);
  const [isSubmittingTwoFactor, setIsSubmittingTwoFactor] = useState(false);
  const [sessionContinuationState, setSessionContinuationState] =
    useState<SessionContinuationState>('idle');
  const isBackgroundRefreshInFlightRef = useRef(false);
  const hasAttemptedSessionContinuationRef = useRef(false);
  const hasResolvedInitialAuthRef = useRef(false);
  const hasRecoveredVerifiedSession = sessionContinuationState === 'verified';
  const isContinuingSession = sessionContinuationState === 'checking';

  const viewModel = getSetupViewModel({
    isAuthenticated,
    isEmailConfigured,
    hasVerificationCallback,
    hasVerifiedEmailInSession,
    requiresEmailVerification,
    requiresMfaSetup,
    resolvedEmail,
    sessionContinuationState,
  });

  useEffect(() => {
    if (!isPending) {
      hasResolvedInitialAuthRef.current = true;
    }
  }, [isPending]);

  useEffect(() => {
    if (!hasVerificationCallback && !hasVerifiedEmailInSession) {
      setSessionContinuationState('idle');
    }
  }, [hasVerificationCallback, hasVerifiedEmailInSession]);

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

  const runStatusCheck = useCallback(
    async (background: boolean) => {
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
        setInfoMessage(null);
        setSessionContinuationState('idle');
      }

      try {
        const refreshedSession = await refreshAuthClientSession(queryClient);

        if (!background) {
          if (refreshedSession?.user?.emailVerified) {
            setSessionContinuationState('verified');
            setInfoMessage(null);
          } else {
            setInfoMessage(
              'Still waiting for verification. Open the latest email link or resend the email.',
            );
          }
        }
      } finally {
        if (background) {
          isBackgroundRefreshInFlightRef.current = false;
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [queryClient],
  );

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
  }, [runStatusCheck, viewModel.canPollStatus, viewModel.currentStage]);

  useEffect(() => {
    const shouldAttemptAutomaticContinuation =
      viewModel.currentStage === 'bridging' &&
      (hasVerificationCallback || hasVerifiedEmailInSession) &&
      !hasRecoveredVerifiedSession;

    if (!shouldAttemptAutomaticContinuation) {
      hasAttemptedSessionContinuationRef.current = false;
      if (sessionContinuationState === 'checking') {
        setSessionContinuationState('idle');
      }
      return;
    }

    if (hasAttemptedSessionContinuationRef.current) {
      return;
    }

    hasAttemptedSessionContinuationRef.current = true;
    setInfoMessage('Trying to continue your session...');
    setSessionContinuationState('checking');

    void (async () => {
      try {
        for (let attempt = 0; attempt < SESSION_CONTINUATION_MAX_ATTEMPTS; attempt += 1) {
          const session = await refreshAuthClientSession(queryClient);
          if (session?.user?.emailVerified) {
            setSessionContinuationState('verified');
            setInfoMessage(null);
            return;
          }

          if (attempt < SESSION_CONTINUATION_MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, SESSION_CONTINUATION_RETRY_DELAY_MS);
            });
          }
        }

        setSessionContinuationState('failed');
        setInfoMessage(
          "We couldn't continue automatically. Sign in to finish setting up your account.",
        );
      } catch {
        setSessionContinuationState('failed');
        setInfoMessage(
          "We couldn't continue automatically. Sign in to finish setting up your account.",
        );
      }
    })();
  }, [
    hasRecoveredVerifiedSession,
    hasVerificationCallback,
    hasVerifiedEmailInSession,
    queryClient,
    sessionContinuationState,
    viewModel.currentStage,
  ]);

  if (isPending && !hasResolvedInitialAuthRef.current) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated && !requiresEmailVerification && !requiresMfaSetup) {
    return <Navigate to={redirectTarget} replace />;
  }

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
    setInfoMessage(null);
    setSuccessMessage(null);

    try {
      const callbackURL =
        typeof window === 'undefined'
          ? undefined
          : getAccountSetupCallbackUrl(window.location.origin, {
              redirectTo: redirectTarget,
            });

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
    setInfoMessage(null);
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
    setInfoMessage(null);
    setSuccessMessage(null);
    setNeedsFreshSignInForPasskey(false);

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
      if (isSessionNotFreshError(passkeyError)) {
        setNeedsFreshSignInForPasskey(true);
        setInfoMessage(
          'For security, passkey setup requires a recent sign-in. Sign in again to continue, then return here to finish MFA setup.',
        );
        setError(null);
        return;
      }

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
    setIsSubmittingTwoFactor(true);
    setError(null);
    setInfoMessage(null);
    setNeedsFreshSignInForPasskey(false);

    try {
      const response = await beginAuthenticatorOnboardingServerFn();
      setPendingTotpUri(response.totpURI ?? null);
      setBackupCodes(response.backupCodes ?? []);
      setIsContinuingToAuthenticator(false);
      setIsBackupCodesOpen(true);
    } catch (twoFactorError) {
      setError(getEnrollmentErrorMessage(twoFactorError));
    } finally {
      setIsSubmittingTwoFactor(false);
    }
  }

  function handleContinueToAuthenticator() {
    setIsContinuingToAuthenticator(true);
    void router
      .navigate({
        to: '/two-factor',
        search: {
          ...(redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {}),
          ...(pendingTotpUri ? { totpURI: pendingTotpUri } : {}),
        },
      })
      .catch(() => {
        setIsContinuingToAuthenticator(false);
      });
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
              <CardTitle className="text-3xl font-normal tracking-tight">
                {viewModel.title}
              </CardTitle>
              <CardDescription className="text-sm leading-6 text-foreground">
                {viewModel.rationale}
              </CardDescription>
              {viewModel.subtitle ? (
                <CardDescription className="max-w-md text-sm leading-6">
                  {viewModel.subtitle}
                </CardDescription>
              ) : null}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {successMessage ? <Notice tone="success">{successMessage}</Notice> : null}

            {infoMessage ? (
              <Notice tone="neutral">
                <div className="flex items-center gap-2">
                  {isContinuingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{infoMessage}</span>
                </div>
              </Notice>
            ) : null}

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
                        <p className="text-foreground">
                          {hasVerifiedEmailInSession || hasVerificationCallback
                            ? 'We verified your email. Restoring your session now.'
                            : 'Checking your verification status.'}
                        </p>
                        <p>
                          {hasVerifiedEmailInSession || hasVerificationCallback
                            ? 'We&apos;ll continue automatically as soon as your secure setup session is ready.'
                            : 'We&apos;ll keep checking automatically, or you can confirm below.'}
                        </p>
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
                          {resolvedEmail
                            ? `We sent a verification email to ${resolvedEmail}.`
                            : 'We sent a verification email to your email address.'}
                        </p>
                        <p>Open the link in that email to continue.</p>
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
                            className="w-full border-border/60 text-muted-foreground hover:text-foreground"
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
                                : 'Send a new verification email'}
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
                title="Set up MFA"
                detail={
                  viewModel.securityStepComplete
                    ? 'Complete'
                    : viewModel.isAwaitingSignInAfterVerification
                      ? 'Current step'
                      : viewModel.currentStep === 2
                        ? 'Current step'
                        : 'Available after verification'
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
                      <p>
                        {isContinuingSession
                          ? 'Trying to continue automatically.'
                          : 'Sign in to continue to MFA setup.'}
                      </p>
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
                      <p className="font-normal text-muted-foreground">
                        {needsFreshSignInForPasskey
                          ? 'Passkey setup requires a recent sign-in.'
                          : 'Passkeys are recommended on this device.'}
                      </p>
                    </StepSummary>

                    <div className="flex flex-col gap-3">
                      {viewModel.canAddPasskey ? (
                        needsFreshSignInForPasskey ? (
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
                              Sign in again to add passkey
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            className="w-full"
                            onClick={() => void handleAddPasskey()}
                          >
                            {isAddingPasskey ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ShieldCheck className="size-4" />
                            )}
                            {isAddingPasskey ? 'Adding passkey' : 'Add passkey'}
                          </Button>
                        )
                      ) : null}
                      {viewModel.canAddPasskey && viewModel.canAddAuthenticator ? (
                        <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-muted-foreground/70">
                          <div className="h-px flex-1 bg-border/70" />
                          <span>or</span>
                          <div className="h-px flex-1 bg-border/70" />
                        </div>
                      ) : null}
                      {viewModel.canAddAuthenticator ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => void handleEnableAuthenticator()}
                          disabled={isSubmittingTwoFactor}
                        >
                          {isSubmittingTwoFactor ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <KeyRound className="size-4" />
                          )}
                          {isSubmittingTwoFactor
                            ? 'Preparing authenticator app'
                            : 'Use authenticator app'}
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
