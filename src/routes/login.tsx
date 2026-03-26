import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate, useRouter } from '@tanstack/react-router';
import { Fingerprint, Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { Separator } from '~/components/ui/separator';
import { authClient, refreshAuthClientSession } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { useAuth } from '~/features/auth/hooks/useAuth';
import {
  getAccountSetupCallbackUrl,
  normalizeAppRedirectTarget,
} from '~/features/auth/lib/account-setup-routing';
import { getBetterAuthUserFacingMessage } from '~/features/auth/lib/better-auth-client-error';
import { resolveEnterpriseAuthDiscoveryServerFn } from '~/features/auth/server/enterprise-auth';

export const Route = createFileRoute('/login')({
  staticData: true,
  component: LoginPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    email: z
      .string()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .optional(),
    redirectTo: z.string().regex(/^\/.*/).optional(),
    reset: z.string().optional(),
    verified: z.string().optional(),
  }),
});

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Please enter a valid email address');

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function getPasswordSignInError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes('requires enterprise sign-in') ||
    normalizedMessage.includes('password sign-in is disabled') ||
    normalizedMessage.includes('organization-managed sign-in')
  ) {
    return 'Your organization requires managed sign-in. Use Continue with Google.';
  }

  return message;
}

function getGoogleSignInError(
  resolution:
    | {
        canUsePasswordFallback: boolean;
        protocol: 'oidc';
        providerKey: 'google-workspace' | 'entra' | 'okta';
        requiresEnterpriseAuth: boolean;
      }
    | null
    | undefined,
) {
  if (!resolution) {
    return 'No Google Workspace sign-in is configured for this account.';
  }

  return null;
}

function LoginPage() {
  const { email, redirectTo, reset, verified } = Route.useSearch();
  const {
    isAuthenticated,
    isPending,
    requiresEmailVerification,
    requiresMfaSetup,
    requiresMfaVerification,
  } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const redirectTarget = normalizeAppRedirectTarget(redirectTo);
  const [showResetSuccess] = useState(reset === 'success');
  const [showVerifySuccess] = useState(verified === 'success');
  const [emailInput, setEmailInput] = useState(email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const [isSubmittingGoogle, setIsSubmittingGoogle] = useState(false);
  const [isSubmittingPasskey, setIsSubmittingPasskey] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const normalizedEmail = normalizeEmail(emailInput);
  const parsedEmail = emailSchema.safeParse(normalizedEmail);
  const emailForLookup = parsedEmail.success ? normalizedEmail : '';
  const { data: enterpriseResolution } = useQuery({
    enabled: emailForLookup.length > 0,
    queryFn: async () =>
      await resolveEnterpriseAuthDiscoveryServerFn({
        data: { email: emailForLookup },
      }),
    queryKey: ['enterprise-auth-discovery', emailForLookup],
    staleTime: 30_000,
  });
  const postSignInRedirectUrl = useMemo(
    () =>
      typeof window === 'undefined'
        ? redirectTarget
        : new URL(redirectTarget, window.location.origin).toString(),
    [redirectTarget],
  );
  const verificationCallbackURL = useMemo(
    () =>
      typeof window === 'undefined'
        ? undefined
        : getAccountSetupCallbackUrl(window.location.origin, {
            redirectTo: redirectTarget,
          }),
    [redirectTarget],
  );

  useEffect(() => {
    if (reset !== 'success' && verified !== 'success') {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete('reset');
    searchParams.delete('verified');
    const nextSearch = searchParams.toString();
    const nextHref = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    router.history.replace(nextHref);
  }, [reset, router, verified]);

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    if (requiresEmailVerification || requiresMfaSetup) {
      return (
        <Navigate
          to="/account-setup"
          search={{
            ...(redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {}),
            ...(verified === 'success' ? { verified: 'success' } : {}),
          }}
          replace
        />
      );
    }

    if (requiresMfaVerification) {
      return (
        <Navigate
          to="/two-factor"
          search={redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {}}
          replace
        />
      );
    }

    return <Navigate to={redirectTarget} replace />;
  }

  const handlePasswordSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const validatedEmail = emailSchema.safeParse(emailInput);
    if (!validatedEmail.success) {
      setError(validatedEmail.error.issues[0]?.message ?? 'Email is required');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    setIsSubmittingPassword(true);

    try {
      await authClient.signIn.email({
        email: normalizeEmail(validatedEmail.data),
        password,
        // Better Auth reuses the sign-in callback URL when sendOnSignIn verification
        // mail is triggered for an unverified account. Keep that callback pointed at
        // account setup, while successful sign-ins still navigate client-side below.
        callbackURL: verificationCallbackURL ?? postSignInRedirectUrl,
        fetchOptions: { throw: true },
      });
      await refreshAuthClientSession(queryClient);

      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/two-factor')) {
        return;
      }

      await router.invalidate();
      router.history.replace(redirectTarget);
    } catch (signInError) {
      const message = getBetterAuthUserFacingMessage(signInError, {
        fallback: 'Unable to sign in. Please try again.',
        // OWASP-style: do not reveal whether the email exists vs password was wrong.
        invalidPasswordSignInCopy: 'Incorrect email or password.',
      });

      if (message.toLowerCase().includes('email not verified')) {
        await router.navigate({
          to: '/account-setup',
          search: {
            email: normalizeEmail(validatedEmail.data),
            ...(redirectTarget !== '/app' ? { redirectTo: redirectTarget } : {}),
          },
          replace: true,
        });
        return;
      }

      setError(getPasswordSignInError(message));
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmittingGoogle(true);

    try {
      if (parsedEmail.success && enterpriseResolution !== undefined) {
        const googleError = getGoogleSignInError(enterpriseResolution);
        if (googleError) {
          setError(googleError);
          return;
        }
      }

      await authClient.signIn.social({
        callbackURL: postSignInRedirectUrl,
        errorCallbackURL:
          typeof window === 'undefined'
            ? '/login'
            : new URL('/login', window.location.origin).toString(),
        ...(parsedEmail.success ? { loginHint: normalizedEmail } : {}),
        provider: 'google',
      });
    } catch (googleError) {
      setError(
        getBetterAuthUserFacingMessage(googleError, {
          fallback: 'Unable to start Google sign-in. Please try again.',
        }),
      );
    } finally {
      setIsSubmittingGoogle(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError('');
    setIsSubmittingPasskey(true);

    try {
      await authClient.signIn.passkey({
        fetchOptions: { throw: true },
      });

      await refreshAuthClientSession(queryClient);
      await router.invalidate();
      router.history.replace(redirectTarget);
    } catch (passkeyError) {
      setError(
        getBetterAuthUserFacingMessage(passkeyError, {
          fallback: 'Unable to sign in with a passkey. Please try again.',
        }),
      );
    } finally {
      setIsSubmittingPasskey(false);
    }
  };

  return (
    <AuthRouteShell
      supplemental={
        showResetSuccess ? (
          <div className="rounded border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
            Password reset successful. Sign in with your new password.
          </div>
        ) : showVerifySuccess ? (
          <div className="rounded border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
            Email verified. Sign in to continue.
          </div>
        ) : undefined
      }
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-3xl">Sign in</CardTitle>
          <CardDescription>
            Use your email and password, or continue with Google if your organization uses Google
            Workspace sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error ? (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handlePasswordSignIn}>
            <Field>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                type="email"
                autoComplete="email"
                value={emailInput}
                onChange={(event) => {
                  setEmailInput(event.target.value);
                  setError('');
                }}
                placeholder="you@company.com"
              />
            </Field>

            <Field>
              <div className="mb-2 flex items-center justify-between">
                <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                <Link
                  to="/forgot-password"
                  search={{
                    ...(parsedEmail.success ? { email: normalizedEmail } : {}),
                    ...(redirectTo ? { redirectTo } : {}),
                  }}
                  className="text-sm font-medium hover:text-muted-foreground"
                >
                  Forgot your password?
                </Link>
              </div>
              <Input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
                placeholder="Password"
              />
            </Field>

            <Button className="w-full" type="submit">
              {isSubmittingPassword ? <Loader2 className="size-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>

          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-sm text-muted-foreground">Or continue with</span>
            <Separator className="flex-1" />
          </div>

          <Button className="w-full" type="button" variant="outline" onClick={handleGoogleSignIn}>
            {isSubmittingGoogle ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue with Google
          </Button>

          <Button
            className="w-full justify-center text-sm"
            type="button"
            variant="ghost"
            onClick={handlePasskeySignIn}
          >
            {isSubmittingPasskey ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Fingerprint className="size-4" />
            )}
            Sign in with Passkey
          </Button>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            search={{
              ...(parsedEmail.success ? { email: normalizedEmail } : {}),
              ...(redirectTo ? { redirectTo } : {}),
            }}
            className="ml-1 font-medium text-foreground underline underline-offset-4"
          >
            Sign up
          </Link>
        </CardFooter>
      </Card>
    </AuthRouteShell>
  );
}
