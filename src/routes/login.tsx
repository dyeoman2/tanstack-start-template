import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { signIn } from '~/features/auth/auth-client';

export const Route = createFileRoute('/login')({
  component: LoginPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    reset: z.string().optional(),
    redirect: z
      .string()
      .regex(/^\/|https?:\/\/.*$/)
      .optional(),
  }),
});

function LoginPage() {
  const { reset } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();

  // For login page, assume user is not authenticated
  const session = { user: null };

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const emailId = useId();
  const passwordId = useId();

  const form = useForm({
    defaultValues: {
      email: import.meta.env.DEV ? '' : '',
      password: import.meta.env.DEV ? '' : '',
    },
    onSubmit: async ({ value }) => {
      setError('');

      try {
        const { data, error: signInError } = await signIn.email(
          {
            email: value.email,
            password: value.password,
            rememberMe: true,
          },
          {
            onSuccess: () => undefined,
            onError: () => undefined,
          },
        );

        if (signInError) {
          if (signInError.status === 403) {
            setError('Please verify your email address before signing in.');
          } else if (signInError.status === 401) {
            setError('Invalid email or password. Please check your credentials and try again.');
          } else {
            setError(signInError.message || 'Sign-in failed. Please try again.');
          }
          return;
        }

        if (data) {
          await router.invalidate();
          // Small delay to ensure invalidation settles before navigation
          setTimeout(() => {
            navigate({ to: '/' });
          }, 50);
        } else {
          setError('An unexpected error occurred. Please try again.');
        }
      } catch (error: unknown) {
        const errorObj = error as {
          message?: string;
          code?: string;
          status?: number;
          error?: { message?: string; code?: string };
        };
        const errorMessage = errorObj?.message || errorObj?.error?.message || '';
        const errorCode = errorObj?.code || errorObj?.error?.code || '';

        if (
          errorMessage.includes('Invalid email or password') ||
          errorCode === 'INVALID_EMAIL_OR_PASSWORD' ||
          errorObj?.status === 401
        ) {
          setError('Invalid email or password. Please check your credentials and try again.');
        } else if (errorMessage.includes('User not found') || errorCode === 'USER_NOT_FOUND') {
          setError(
            'No account found with this email address. Please check your email or create an account.',
          );
        } else if (
          errorMessage.includes('Too many attempts') ||
          errorMessage.includes('rate limit')
        ) {
          setError('Too many login attempts. Please wait a few minutes and try again.');
        } else {
          setError(`Login failed. Please try again. (Error: ${errorMessage || 'Unknown error'})`);
        }
      }
    },
  });

  useEffect(() => {
    if (reset === 'success') {
      setSuccessMessage('Password reset successful! Please sign in with your new password.');
      form.setFieldValue('password', '');
    } else {
      setSuccessMessage('');
    }
  }, [reset, form]);

  // Login page doesn't auto-redirect since session is always null

  if (session?.user) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <form
          className="mt-8 space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          {successMessage && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
              {successMessage}
            </div>
          )}
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
                  data-lpignore="true"
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
          <form.Field
            name="password"
            validators={{
              onChange: ({ value }) => {
                if (!value) return 'Password is required';
                if (value.length < 8) return 'Password must be at least 8 characters long';
                if (value.length > 128) return 'Password must be less than 128 characters';
                return undefined;
              },
            }}
          >
            {(field) => (
              <div>
                <label htmlFor={passwordId} className="sr-only">
                  Password
                </label>
                <input
                  id={passwordId}
                  name={field.name}
                  type="password"
                  required
                  autoComplete="current-password"
                  data-lpignore="true"
                  className={`relative block w-full px-3 py-2 bg-white border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:z-10 sm:text-sm ${
                    field.state.meta.errors.length > 0
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                  placeholder="Password"
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
            {([canSubmit, isSubmitting]) => (
              <div>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            )}
          </form.Subscribe>
          <div className="text-center space-y-2">
            <div>
              <Link
                to="/forgot-password"
                search={form.getFieldValue('email') ? { email: form.getFieldValue('email') } : {}}
                className="font-medium text-indigo-600 hover:text-indigo-500"
              >
                Forgot your password?
              </Link>
            </div>
            <div>
              <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
                Don't have an account? Sign up
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
