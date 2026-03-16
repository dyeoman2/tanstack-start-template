import { api } from '@convex/_generated/api';
import { AuthView } from '@daveyplate/better-auth-ui';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Mail } from 'lucide-react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { AuthEmailPrefill } from '~/features/auth/components/AuthEmailPrefill';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { useAuthState } from '~/features/auth/hooks/useAuthState';

export const Route = createFileRoute('/forgot-password')({
  staticData: true,
  component: ForgotPasswordPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    email: z
      .string()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .optional(),
    redirectTo: z.string().regex(/^\/.*/).optional(),
  }),
});

function ForgotPasswordPage() {
  const { email, redirectTo } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuthState();
  const emailServiceStatus = useQuery(api.emails.checkEmailServiceConfigured, {});
  const isEmailConfigured = emailServiceStatus?.isConfigured ?? true;

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    return <Navigate to="/app" replace />;
  }

  if (!isEmailConfigured) {
    return (
      <AuthRouteShell supplemental={<ResendSetupCard />}>
        <div className="text-center text-sm text-muted-foreground">
          Password reset is unavailable until email delivery is configured.
        </div>
        <div className="text-center">
          <Link
            to="/login"
            search={{
              ...(email ? { email } : {}),
              ...(redirectTo ? { redirectTo } : {}),
            }}
            className="font-medium hover:text-muted-foreground"
          >
            Back to sign in
          </Link>
        </div>
      </AuthRouteShell>
    );
  }

  return (
    <AuthRouteShell>
      <AuthEmailPrefill email={email} />
      <AuthView view="FORGOT_PASSWORD" />
    </AuthRouteShell>
  );
}

function ResendSetupCard() {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2 text-amber-800">
          <Mail className="h-5 w-5" />
          <span>Resend Email Setup Required</span>
        </CardTitle>
        <CardDescription className="text-amber-700">
          To use password reset functionality, set the Resend API key in Convex.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 text-sm text-amber-800">
          <div className="space-y-2">
            <p className="font-semibold">Setup Steps:</p>
            <ol className="ml-4 list-decimal list-inside space-y-3">
              <li>
                Create a Resend account at{' '}
                <button
                  type="button"
                  onClick={() => window.open('https://resend.com', '_blank')}
                  className="font-medium text-amber-600 underline hover:text-amber-800"
                >
                  resend.com
                </button>
              </li>
              <li>Create a new API key from the Resend dashboard</li>
              <li>
                Set the environment variable in Convex:
                <div className="mt-2 ml-4 space-y-1 rounded border bg-white p-2 font-mono text-xs">
                  <div className="mb-1">Development:</div>
                  <div>npx convex env set RESEND_API_KEY your_api_key_here</div>
                  <div className="mt-2 mb-1">Production:</div>
                  <div>npx convex env set RESEND_API_KEY your_api_key_here --prod</div>
                </div>
              </li>
              <li>Or use the Convex Dashboard: Settings → Environment Variables</li>
            </ol>
            <p className="mt-2 text-xs text-amber-700">
              <strong>Note:</strong> This variable must be set in Convex, not in local `.env` files
              or Netlify.
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/docs/RESEND_SETUP.md', '_blank')}
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
          >
            Setup Guide
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('https://resend.com', '_blank')}
            className="border-amber-300 text-amber-700 hover:bg-amber-100"
          >
            Resend Dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
