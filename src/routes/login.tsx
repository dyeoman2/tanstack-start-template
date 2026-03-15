import { AuthView } from '@daveyplate/better-auth-ui';
import { api } from '@convex/_generated/api';
import { createFileRoute, Navigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { AuthEmailPrefill } from '~/features/auth/components/AuthEmailPrefill';
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

function resolveRedirectTarget(value?: string | null): RedirectTarget {
  if (!value) {
    return '/app';
  }

  const [path] = value.split('?');
  const match = REDIRECT_TARGETS.find((route) => route === path);

  return (match ?? '/app') as RedirectTarget;
}

function LoginPage() {
  const { email, redirectTo, reset, verified } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuth({ fetchRole: false });
  const router = useRouter();
  const redirectTarget = resolveRedirectTarget(redirectTo);
  const [showResetSuccess] = useState(reset === 'success');
  const [showVerifySuccess] = useState(verified === 'success');
  const [emailInput, setEmailInput] = useState(email ?? '');
  const [lookupEmail, setLookupEmail] = useState(email?.trim().toLowerCase() ?? '');
  const [isStartingEnterpriseAuth, setIsStartingEnterpriseAuth] = useState(false);
  const enterpriseResolution = useQuery(
    api.organizationManagement.resolveOrganizationEnterpriseAuthByEmail,
    lookupEmail ? { email: lookupEmail } : 'skip',
  );
  const isLookupPending = lookupEmail.length > 0 && enterpriseResolution === undefined;
  const enterpriseRequired =
    enterpriseResolution !== null &&
    enterpriseResolution !== undefined &&
    enterpriseResolution.enterpriseAuthMode === 'required' &&
    enterpriseResolution.providerStatus === 'active';
  const enterpriseOptional =
    enterpriseResolution !== null &&
    enterpriseResolution !== undefined &&
    enterpriseResolution.enterpriseAuthMode === 'optional' &&
    enterpriseResolution.providerStatus === 'active';
  const enterpriseUnavailable =
    enterpriseResolution !== null &&
    enterpriseResolution !== undefined &&
    enterpriseResolution.providerStatus !== 'active';
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

  const startEnterpriseAuth = useEffectEvent(async () => {
    if (!enterpriseResolution || enterpriseResolution.providerStatus !== 'active') {
      return;
    }

    setIsStartingEnterpriseAuth(true);
    try {
      await authClient.signIn.social({
        callbackURL,
        errorCallbackURL:
          typeof window === 'undefined'
            ? '/login'
            : new URL('/login', window.location.origin).toString(),
        loginHint: lookupEmail || emailInput.trim().toLowerCase(),
        provider: 'google',
      });
    } finally {
      setIsStartingEnterpriseAuth(false);
    }
  });

  useEffect(() => {
    if (!enterpriseRequired || isStartingEnterpriseAuth) {
      return;
    }

    void startEnterpriseAuth();
  }, [enterpriseRequired, isStartingEnterpriseAuth, startEnterpriseAuth]);

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTarget} replace />;
  }

  const handleDiscoverySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = emailInput.trim().toLowerCase();
    if (!normalizedEmail) {
      return;
    }

    setLookupEmail(normalizedEmail);
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
      <form className="space-y-3" onSubmit={handleDiscoverySubmit}>
        <Field>
          <FieldLabel htmlFor="login-email-discovery">Work email</FieldLabel>
          <Input
            id="login-email-discovery"
            type="email"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Button className="w-full" type="submit">
          {isLookupPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Continue
        </Button>
      </form>

      {enterpriseResolution && enterpriseOptional ? (
        <div className="rounded border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-medium">
            Google Workspace sign-in is available for {enterpriseResolution.organizationName}.
          </p>
          <p className="mt-1 text-muted-foreground">
            Continue with your organization Google Workspace account or use your password below.
          </p>
          <Button className="mt-3 w-full" onClick={() => void startEnterpriseAuth()} type="button">
            {isStartingEnterpriseAuth ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue with Google Workspace
          </Button>
        </div>
      ) : null}

      {enterpriseResolution && enterpriseRequired ? (
        <div className="rounded border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-medium">This organization requires enterprise sign-in.</p>
          <p className="mt-1 text-muted-foreground">
            Redirecting you to Google Workspace.
          </p>
        </div>
      ) : null}

      {enterpriseResolution && enterpriseUnavailable ? (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Ask an organization owner to finish enterprise sign-in setup before using Google
          Workspace.
        </div>
      ) : null}

      {!enterpriseRequired ? (
        <>
          <AuthEmailPrefill email={lookupEmail || email} />
          <AuthView redirectTo={redirectTarget} view="SIGN_IN" />
        </>
      ) : null}
    </AuthRouteShell>
  );
}
