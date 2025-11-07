import { api } from '@convex/_generated/api';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { ClientOnly } from '~/components/ClientOnly';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import { authClient } from '~/features/auth/auth-client';
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
  }),
});

function ForgotPasswordPage() {
  const { email: emailFromQuery } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuthState();
  // Use Convex query directly instead of server function wrapper
  const emailServiceStatus = useQuery(api.emails.checkEmailServiceConfigured, {});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [error, setError] = useState('');
  const emailId = useId();

  const form = useForm({
    defaultValues: {
      email: emailFromQuery || '',
    },
    onSubmit: async ({ value }) => {
      setError('');
      setSubmittedEmail(value.email);

      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!value.email) {
        setError('Email is required');
        return;
      } else if (!emailRegex.test(value.email)) {
        setError('Please enter a valid email address');
        return;
      }

      try {
        await authClient.forgetPassword({
          email: value.email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setIsSubmitted(true);
      } catch (error) {
        console.error('Forgot password error:', error);
        setError('Failed to send reset email. Please try again.');
      }
    },
  });

  // Get current email value for navigation links
  const [currentEmail, setCurrentEmail] = useState(emailFromQuery || '');

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    throw redirect({ to: '/app' });
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="mt-6 text-3xl font-extrabold text-foreground">Check your email</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We've sent a password reset link to <strong>{submittedEmail}</strong>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Check your console in development mode to see the reset link.
            </p>
          </div>
          <div className="text-center">
            <Link
              to="/login"
              search={
                submittedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submittedEmail)
                  ? { email: submittedEmail }
                  : {}
              }
              className="font-medium  hover:text-muted-foreground"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="flex justify-center">
            <Link
              to="/"
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
            >
              <img
                src="/android-chrome-192x192.png"
                alt="TanStack Start Template Logo"
                className="w-12 h-12 rounded hover:opacity-80 transition-opacity"
              />
            </Link>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-foreground">
            Forgot your password?
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Enter your email address and we'll send you a link to reset your password.
          </p>
          {emailServiceStatus && !emailServiceStatus.isConfigured && (
            <Card className="mt-4 border-amber-200 bg-amber-50">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-amber-800">
                  <Mail className="w-5 h-5" />
                  <span>Resend Email Setup Required</span>
                </CardTitle>
                <CardDescription className="text-amber-700">
                  To use password reset functionality, you need to set up the Resend API key in
                  Convex.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-amber-800 space-y-3">
                  <div className="space-y-2">
                    <p className="font-semibold">Setup Steps:</p>
                    <ol className="list-decimal list-inside space-y-3 ml-4">
                      <li>
                        Create a Resend account at{' '}
                        <button
                          type="button"
                          onClick={() => window.open('https://resend.com', '_blank')}
                          className="text-amber-600 hover:text-amber-800 underline font-medium"
                        >
                          resend.com
                        </button>
                      </li>
                      <li>Create a new API key from the Resend dashboard</li>
                      <li>
                        Set the environment variable in Convex:
                        <div className="bg-white p-2 rounded border font-mono text-xs space-y-1 mt-2 ml-4">
                          <div className="mb-1">Development:</div>
                          <div>npx convex env set RESEND_API_KEY your_api_key_here</div>
                          <div className="mt-2 mb-1">Production:</div>
                          <div>npx convex env set RESEND_API_KEY your_api_key_here --prod</div>
                        </div>
                      </li>
                      <li>Or use the Convex Dashboard: Settings → Environment Variables</li>
                    </ol>
                    <p className="text-xs text-amber-700 mt-2">
                      <strong>Note:</strong> This variable must be set in Convex, not in your local
                      `.env` file or Netlify.
                    </p>
                  </div>
                </div>
                <div className="flex space-x-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open('/docs/RESEND_SETUP.md', '_blank')}
                    className="text-amber-700 border-amber-300 hover:bg-amber-100"
                  >
                    📖 Setup Guide
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open('https://resend.com', '_blank')}
                    className="text-amber-700 border-amber-300 hover:bg-amber-100"
                  >
                    🔗 Resend Dashboard
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        <ClientOnly
          fallback={
            <div className="mt-8 space-y-6 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mx-auto"></div>
              <div className="space-y-4">
                <div className="h-10 bg-muted rounded"></div>
                <div className="h-10 bg-muted rounded"></div>
              </div>
            </div>
          }
        >
          <form
            className="mt-8 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            {error && (
              <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
                {error}
              </div>
            )}
            <form.Field name="email">
              {(field) => (
                <Field>
                  <FieldLabel className="sr-only">Email address</FieldLabel>
                  <InputGroup>
                    <InputGroupIcon>
                      <Mail />
                    </InputGroupIcon>
                    <InputGroupInput
                      id={emailId}
                      name={field.name}
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="Email address"
                      value={field.state.value}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                        setCurrentEmail(e.target.value);
                      }}
                      onBlur={field.handleBlur}
                    />
                  </InputGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  )}
                </Field>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => {
                // Default to true while loading to avoid blocking user
                const isEmailConfigured = emailServiceStatus?.isConfigured ?? true;
                const isDisabled = !canSubmit || !isEmailConfigured;

                return (
                  <Button type="submit" disabled={isDisabled} className="w-full">
                    {isSubmitting ? 'Sending...' : 'Send reset link'}
                  </Button>
                );
              }}
            </form.Subscribe>
            <div className="text-center">
              <Link
                to="/login"
                search={
                  currentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)
                    ? { email: currentEmail }
                    : {}
                }
                className="font-medium  hover:text-muted-foreground"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        </ClientOnly>
      </div>
    </div>
  );
}
