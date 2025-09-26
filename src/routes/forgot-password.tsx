import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { ClientOnly } from '~/components/ClientOnly';
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

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">Check your email</h2>
            <p className="mt-2 text-sm text-gray-600">
              We've sent a password reset link to <strong>{submittedEmail}</strong>
            </p>
            <p className="mt-4 text-sm text-gray-500">
              Check your console in development mode to see the reset link.
            </p>
          </div>
          <div className="text-center">
            <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Forgot your password?
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter your email address and we'll send you a link to reset your password.
          </p>
          {emailServiceStatus && !emailServiceStatus.isConfigured && (
            <div className="mt-4 bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
              <div className="font-medium mb-2">Email service not configured</div>
              <div className="text-sm space-y-2">
                <p>
                  Password reset functionality requires the{' '}
                  <code className="bg-yellow-200 px-1 rounded text-xs">RESEND_API_KEY</code>{' '}
                  environment variable to be set.
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
                        className="underline hover:text-yellow-800"
                      >
                        resend.com
                      </a>{' '}
                      and create an account
                    </li>
                    <li>Create a new API key</li>
                    <li>
                      Add{' '}
                      <code className="bg-yellow-200 px-1 rounded text-xs">
                        RESEND_API_KEY=your_api_key_here
                      </code>{' '}
                      to your <code className="bg-yellow-200 px-1 rounded text-xs">.env.local</code>{' '}
                      file (local development)
                    </li>
                    <li>
                      For production: Add the same variable to your Netlify environment variables
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
              <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto"></div>
              <div className="space-y-4">
                <div className="h-10 bg-gray-200 rounded"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
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
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}
            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) => {
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!value) return 'Email is required';
                  if (!emailRegex.test(value)) return 'Please enter a valid email address';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <div>
                  <label htmlFor={emailId} className="sr-only">
                    Email address
                  </label>
                  <input
                    id={emailId}
                    name={field.name}
                    type="email"
                    required
                    autoComplete="email"
                    className={`relative block w-full px-3 py-2 bg-white border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:z-10 sm:text-sm ${
                      field.state.meta.errors.length > 0
                        ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                    }`}
                    placeholder="Email address"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="mt-1 text-sm text-red-600">{field.state.meta.errors[0]}</p>
                  )}
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => {
                const isEmailConfigured = emailServiceStatus?.isConfigured ?? true; // Default to true while loading
                const isDisabled = !canSubmit || !isEmailConfigured;

                return (
                  <div>
                    <button
                      type="submit"
                      disabled={isDisabled}
                      className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? 'Sending...' : 'Send reset link'}
                    </button>
                  </div>
                );
              }}
            </form.Subscribe>
            <div className="text-center">
              <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                Back to sign in
              </Link>
            </div>
          </form>
        </ClientOnly>
      </div>
    </div>
  );
}
