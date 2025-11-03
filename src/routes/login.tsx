import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { Lock, Mail } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import { signIn } from '~/features/auth/auth-client';
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
    reset: z.string().optional(),
    redirect: z
      .string()
      .regex(/^\/|https?:\/\/.*$/)
      .optional(),
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
  const { email: emailFromQuery, reset, redirect: redirectParam } = Route.useSearch();
  const redirectTarget = resolveRedirectTarget(redirectParam);
  const navigate = useNavigate();
  const router = useRouter();
  const { isAuthenticated, isPending } = useAuthState();

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const emailId = useId();
  const passwordId = useId();

  const form = useForm({
    defaultValues: {
      email: emailFromQuery || (import.meta.env.DEV ? '' : ''),
      password: import.meta.env.DEV ? '' : '',
    },
    onSubmit: async ({ value }) => {
      setError('');
      setSuccessMessage('');

      // Validate form fields
      const errors: string[] = [];

      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!value.email) {
        errors.push('Email is required');
      } else if (!emailRegex.test(value.email)) {
        errors.push('Please enter a valid email address');
      }

      // Validate password
      if (!value.password) {
        errors.push('Password is required');
      }

      // Show validation errors if any
      if (errors.length > 0) {
        setError(errors.join('. '));
        return;
      }

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
            navigate({ to: redirectTarget });
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

  // Get current email value for navigation links
  const [currentEmail, setCurrentEmail] = useState(emailFromQuery || '');

  useEffect(() => {
    if (reset === 'success') {
      setSuccessMessage('Password reset successful! Please sign in with your new password.');
      form.setFieldValue('password', '');
    } else {
      setSuccessMessage('');
    }
  }, [reset, form]);

  if (isPending) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    throw redirect({ to: redirectTarget });
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
            <div className="bg-primary/10 border border-primary/20 text-primary px-4 py-3 rounded">
              {successMessage}
            </div>
          )}
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
                    data-lpignore="true"
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
          <form.Field name="password">
            {(field) => (
              <Field>
                <FieldLabel className="sr-only">Password</FieldLabel>
                <InputGroup>
                  <InputGroupIcon>
                    <Lock />
                  </InputGroupIcon>
                  <InputGroupInput
                    id={passwordId}
                    name={field.name}
                    type="password"
                    required
                    autoComplete="current-password"
                    data-lpignore="true"
                    placeholder="Password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
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
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit} className="w-full">
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            )}
          </form.Subscribe>
          <div className="text-center space-y-2">
            <div>
              <Link
                to="/forgot-password"
                search={
                  currentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)
                    ? { email: currentEmail }
                    : {}
                }
                className="font-medium  hover:text-muted-foreground"
              >
                Forgot your password?
              </Link>
            </div>
            <div>
              <Link
                to="/register"
                search={
                  currentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)
                    ? { email: currentEmail }
                    : {}
                }
                className="font-medium  hover:text-muted-foreground"
              >
                Don't have an account? Sign up
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
