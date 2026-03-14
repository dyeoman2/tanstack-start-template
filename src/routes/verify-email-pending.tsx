import { api } from '@convex/_generated/api';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { authClient } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { useAuth } from '~/features/auth/hooks/useAuth';

export const Route = createFileRoute('/verify-email-pending')({
  staticData: true,
  component: VerifyEmailPendingPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    email: z.string().email().optional(),
    redirectTo: z.string().regex(/^\/.*/).optional(),
  }),
});

function VerifyEmailPendingPage() {
  const { email: emailFromSearch, redirectTo } = Route.useSearch();
  const { isAuthenticated, isPending, requiresEmailVerification, user } = useAuth();
  const emailServiceStatus = useQuery(api.emails.checkEmailServiceConfigured, {});
  const isEmailConfigured = emailServiceStatus?.isConfigured ?? true;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resolvedEmail = useMemo(() => {
    return user?.email ?? emailFromSearch ?? null;
  }, [emailFromSearch, user?.email]);

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated && !requiresEmailVerification) {
    return <Navigate to={redirectTo ?? '/app'} replace />;
  }

  const resendVerificationEmail = async () => {
    if (!resolvedEmail) {
      setError('We could not determine which email address to verify.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const callbackURL =
        typeof window === 'undefined'
          ? undefined
          : new URL('/login?verified=success', window.location.origin).toString();

      await authClient.sendVerificationEmail({
        email: resolvedEmail,
        callbackURL,
        fetchOptions: {
          throw: true,
        },
      });

      setSuccessMessage(`Verification email sent to ${resolvedEmail}.`);
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : 'Unable to send a verification email right now.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthRouteShell
      supplemental={
        <Card className="border-primary/15 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Verify your email before accessing the app
            </CardTitle>
            <CardDescription>
              New accounts must confirm their email address before continuing to protected routes.
            </CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Check your inbox</h1>
          <p className="text-sm text-muted-foreground">
            {resolvedEmail
              ? `We sent a verification link to ${resolvedEmail}.`
              : 'We sent a verification link to your account email.'}
          </p>
        </div>

        {!isEmailConfigured ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <Mail className="h-5 w-5" />
                Email delivery is not configured
              </CardTitle>
              <CardDescription className="text-amber-800">
                Set `RESEND_API_KEY` in Convex before requiring email verification in this
                environment.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

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

        <div className="flex flex-col gap-3">
          <Button onClick={() => void resendVerificationEmail()} disabled={isSubmitting || !isEmailConfigured}>
            {isSubmitting ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Sending verification email...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Resend verification email
              </>
            )}
          </Button>
          <Button asChild variant="outline">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    </AuthRouteShell>
  );
}
