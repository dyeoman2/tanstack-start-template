import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { ClientOnly } from '~/components/ClientOnly';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import { authClient } from '~/features/auth/auth-client';
import { checkEmailServiceConfiguredServerFn } from '~/lib/server/email/resend.server';

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  loader: async () => {
    // Preload email service status for initial render
    const emailServiceStatus = await checkEmailServiceConfiguredServerFn();
    return { emailServiceStatus };
  },
  validateSearch: z.object({
    email: z
      .string()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .optional(),
  }),
});

function ForgotPasswordPage() {
  const { email: emailFromQuery } = Route.useSearch();
  const { emailServiceStatus } = Route.useLoaderData();
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
            <div className="mt-4 bg-muted border border-border text-muted-foreground px-4 py-3 rounded">
              <div className="font-medium mb-2 text-foreground">Email service not configured</div>
              <div className="text-sm space-y-2">
                <p>
                  Password reset functionality requires the{' '}
                  <code className="bg-muted px-1 rounded text-xs">RESEND_API_KEY</code> environment
                  variable to be set in your <strong>Convex</strong> environment.
                </p>
                <div className="space-y-1">
                  <p className="font-medium">To fix this:</p>
                  <ol className="list-decimal list-inside space-y-1 text-left ml-4">
                    <li>
                      Go to{' '}
                      <a
                        href="https://resend.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-destructive"
                      >
                        resend.com
                      </a>{' '}
                      and create an account
                    </li>
                    <li>Create a new API key</li>
                    <li>
                      Add{' '}
                      <code className="bg-muted px-1 rounded text-xs">
                        RESEND_API_KEY=your_api_key_here
                      </code>{' '}
                      to your Convex environment (use{' '}
                      <code className="bg-muted px-1 rounded text-xs">npx convex env set</code> or
                      Convex dashboard)
                    </li>
                    <li>
                      For local development: Set in Convex dashboard or via{' '}
                      <code className="bg-muted px-1 rounded text-xs">.env.local</code> (if using
                      Convex CLI)
                    </li>
                  </ol>
                </div>
              </div>
            </div>
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
                const isEmailConfigured = emailServiceStatus?.isConfigured ?? true; // Default to true while loading
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
