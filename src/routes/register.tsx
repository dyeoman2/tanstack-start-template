import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Crown, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { ClientOnly } from '~/components/ClientOnly';
import { useAuth } from '~/features/auth/hooks/useAuth';
import {
  checkIsFirstUserServerFn,
  signUpWithFirstAdminServerFn,
} from '~/features/auth/server/user-management';

export const Route = createFileRoute('/register')({
  errorComponent: () => <div>Something went wrong</div>,
  loader: async () => {
    const firstUserCheck = await checkIsFirstUserServerFn();

    return {
      firstUserCheck,
    };
  },
  component: RegisterPage,
  pendingComponent: AuthSkeleton,
});

function RegisterPage() {
  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const { user, isAuthenticated } = useAuth();
  const session = { user: isAuthenticated ? user : null };
  const navigate = useNavigate();

  // Get data from server loader
  const { firstUserCheck } = Route.useLoaderData();

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const form = useForm({
    defaultValues: {
      email: import.meta.env.DEV ? '' : '',
      password: import.meta.env.DEV ? '' : '',
      name: import.meta.env.DEV ? '' : '',
    },
    onSubmit: async ({ value }) => {
      setError('');
      setSuccessMessage('');

      try {
        const result = await signUpWithFirstAdminServerFn({
          data: { email: value.email, password: value.password, name: value.name },
        });

        // Show success message
        console.log('✅ Registration successful:', result.message);
        setSuccessMessage(result.message || 'Account created successfully!');

        // Navigate to home after showing success message
        setTimeout(() => {
          navigate({ to: '/' });
        }, 2000);
      } catch (error: unknown) {
        console.error('❌ Registration error:', error);

        // Handle specific error messages
        if (
          (error instanceof Error && error.message?.includes('User already exists')) ||
          (error as { code?: string })?.code === 'USER_ALREADY_EXISTS'
        ) {
          setError('An account with this email already exists. Please try logging in instead.');
        } else if (error instanceof Error && error.message?.includes('Invalid email')) {
          setError('Please enter a valid email address.');
        } else if (error instanceof Error && error.message?.includes('Password')) {
          setError('Password does not meet the requirements. Please check the password criteria.');
        } else if (
          (error instanceof Error && error.message?.includes('rate limit')) ||
          (error instanceof Error && error.message?.includes('Too many'))
        ) {
          setError('Too many registration attempts. Please wait a few minutes and try again.');
        } else {
          setError('Registration failed. Please try again.');
        }
      }
    },
  });

  // Redirect if already logged in
  if (session?.user) {
    navigate({ to: '/' });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Create your account
          </h2>
          {firstUserCheck?.isFirstUser && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex">
                <div className="shrink-0">
                  <Crown className="h-5 w-5 text-blue-600" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">Administrator Account</h3>
                  <div className="mt-2 text-sm text-blue-700">
                    As the first user, you will automatically receive administrator privileges with
                    full access to system management features.
                  </div>
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
            {successMessage && (
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
                {successMessage}
                {successMessage.includes('Admin') && (
                  <div className="mt-2 text-sm flex items-center">
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    You have been granted administrator privileges as the first user!
                  </div>
                )}
              </div>
            )}
            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) => {
                  if (!value) return 'Name is required';
                  if (value.length < 2) return 'Name must be at least 2 characters long';
                  if (value.length > 50) return 'Name must be less than 50 characters';
                  if (!/^[a-zA-Z\s'-]+$/.test(value))
                    return 'Name can only contain letters, spaces, hyphens, and apostrophes';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <div>
                  <label htmlFor={nameId} className="sr-only">
                    Full Name
                  </label>
                  <input
                    id={nameId}
                    name={field.name}
                    type="text"
                    required
                    className={`relative block w-full px-3 py-2 bg-white border placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:z-10 sm:text-sm ${
                      field.state.meta.errors.length > 0
                        ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                    }`}
                    placeholder="Full name"
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
            <form.Field
              name="password"
              validators={{
                onChange: ({ value }) => {
                  if (!value) return 'Password is required';
                  if (value.length < 8) return 'Password must be at least 8 characters long';
                  if (value.length > 128) return 'Password must be less than 128 characters';
                  if (!/(?=.*[a-z])/.test(value))
                    return 'Password must contain at least one lowercase letter';
                  if (!/(?=.*[A-Z])/.test(value))
                    return 'Password must contain at least one uppercase letter';
                  if (!/(?=.*\d)/.test(value)) return 'Password must contain at least one number';
                  if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(value))
                    return 'Password must contain at least one symbol';
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
                    autoComplete="new-password"
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
                  {!field.state.meta.errors.length && field.state.value && (
                    <div className="mt-1 text-xs text-gray-500">
                      Password must contain: 8+ characters, uppercase, lowercase, number, and symbol
                    </div>
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
                    {isSubmitting ? 'Creating account...' : 'Create account'}
                  </button>
                </div>
              )}
            </form.Subscribe>
            <div className="text-center">
              <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
                Already have an account? Sign in
              </Link>
            </div>
          </form>
        </ClientOnly>
      </div>
    </div>
  );
}
