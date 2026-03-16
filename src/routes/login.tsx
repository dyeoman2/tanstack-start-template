import { api } from '@convex/_generated/api';
import { createFileRoute, Link, Navigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/components/ui/card';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { Separator } from '~/components/ui/separator';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { authClient } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';

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
    redirectTo: z
      .string()
      .regex(/^\/|https?:\/\/.*$/)
      .optional(),
    reset: z.string().optional(),
    verified: z.string().optional(),
  }),
});

const REDIRECT_TARGETS = [
  '/app',
  '/app/profile',
  '/app/admin',
  '/app/admin/users',
  '/app/admin/stats',
] as const;

type RedirectTarget = (typeof REDIRECT_TARGETS)[number];

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Please enter a valid email address');

function resolveRedirectTarget(value?: string | null): RedirectTarget {
  if (!value) {
    return '/app';
  }

  const [path] = value.split('?');
  const match = REDIRECT_TARGETS.find((route) => route === path);

  return (match ?? '/app') as RedirectTarget;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

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

  return 'Unable to sign in. Please try again.';
}

function getPasswordSignInError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes('requires enterprise sign-in') ||
    normalizedMessage.includes('password sign-in is disabled')
  ) {
    return 'Your organization requires Google Workspace sign-in. Use Continue with Google.';
  }

  return message;
}

function getGoogleSignInError(
  resolution:
    | {
        enterpriseAuthMode: 'off' | 'optional' | 'required';
        organizationName: string;
        providerStatus: string;
      }
    | null
    | undefined,
) {
  if (!resolution) {
    return 'No Google Workspace sign-in is configured for this account.';
  }

  if (resolution.providerStatus !== 'active') {
    return 'Google Workspace sign-in is not available yet. Ask your organization owner to finish setup.';
  }

  return null;
}

function LoginPage() {
  const { email, redirectTo, reset, verified } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuth({ fetchRole: false });
  const router = useRouter();
  const redirectTarget = resolveRedirectTarget(redirectTo);
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
  const enterpriseResolution = useQuery(
    api.organizationManagement.resolveOrganizationEnterpriseAuthByEmail,
    emailForLookup ? { email: emailForLookup } : 'skip',
  );
  const callbackURL = useMemo(
    () =>
      typeof window === 'undefined'
        ? redirectTarget
        : new URL(redirectTarget, window.location.origin).toString(),
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
      const response = await authClient.signIn.email({
        email: normalizeEmail(validatedEmail.data),
        password,
        fetchOptions: { throw: true },
      });

      if (response?.twoFactorRedirect) {
        await router.navigate({
          to: '/two-factor',
          search: redirectTo ? { redirectTo } : {},
        });
        return;
      }

      await router.invalidate();
      await router.navigate({ to: redirectTarget, replace: true });
    } catch (signInError) {
      const message = getErrorMessage(signInError);

      if (message.toLowerCase().includes('email not verified')) {
        await router.navigate({
          to: '/verify-email-pending',
          search: {
            email: normalizeEmail(validatedEmail.data),
            redirectTo: redirectTarget,
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
        callbackURL,
        errorCallbackURL:
          typeof window === 'undefined'
            ? '/login'
            : new URL('/login', window.location.origin).toString(),
        ...(parsedEmail.success ? { loginHint: normalizedEmail } : {}),
        provider: 'google',
      });
    } catch (googleError) {
      setError(getErrorMessage(googleError));
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

      await router.invalidate();
      await router.navigate({ to: redirectTarget, replace: true });
    } catch (passkeyError) {
      setError(getErrorMessage(passkeyError));
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
            Use your email and password, or continue with Google if your organization uses
            Google Workspace sign-in.
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
                  search={parsedEmail.success ? { email: normalizedEmail } : {}}
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
            search={parsedEmail.success ? { email: normalizedEmail } : {}}
            className="ml-1 font-medium text-foreground underline underline-offset-4"
          >
            Sign up
          </Link>
        </CardFooter>
      </Card>
    </AuthRouteShell>
  );
}
