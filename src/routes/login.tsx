import { AuthView } from '@daveyplate/better-auth-ui';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { AuthEmailPrefill } from '~/features/auth/components/AuthEmailPrefill';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { useAuthState } from '~/features/auth/hooks/useAuthState';

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
  const { email, redirectTo, reset } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuthState();
  const router = useRouter();
  const redirectTarget = resolveRedirectTarget(redirectTo);
  const [showResetSuccess] = useState(reset === 'success');

  useEffect(() => {
    if (reset !== 'success') {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete('reset');
    const nextSearch = searchParams.toString();
    const nextHref = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    router.history.replace(nextHref);
  }, [reset, router]);

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    throw redirect({ to: redirectTarget });
  }

  return (
    <AuthRouteShell
      supplemental={
        showResetSuccess ? (
          <div className="rounded border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
            Password reset successful. Sign in with your new password.
          </div>
        ) : undefined
      }
    >
      <AuthEmailPrefill email={email} />
      <AuthView redirectTo={redirectTarget} view="SIGN_IN" />
    </AuthRouteShell>
  );
}
