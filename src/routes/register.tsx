import { api } from '@convex/_generated/api';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Crown, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { ClientOnly } from '~/components/ClientOnly';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import { signIn } from '~/features/auth/auth-client';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { signUpWithFirstAdminServerFn } from '~/features/auth/server/user-management';

export const Route = createFileRoute('/register')({
  staticData: true,
  errorComponent: () => <div>Something went wrong</div>,
  component: RegisterPage,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    email: z
      .string()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .optional(),
  }),
});

function RegisterPage() {
  const { email: emailFromQuery } = Route.useSearch();
  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const { isAuthenticated, isPending } = useAuthState();
  const navigate = useNavigate();
  const router = useRouter();

  // Use Convex query directly instead of server function wrapper
  const userCountResult = useQuery(api.users.getUserCount, {});
  const isFirstUser = userCountResult?.isFirstUser ?? false;

  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const form = useForm({
    defaultValues: {
      email: emailFromQuery || (import.meta.env.DEV ? '' : ''),
      password: import.meta.env.DEV ? '' : '',
      name: import.meta.env.DEV ? '' : '',
    },
    onSubmit: async ({ value }) => {
      setError('');
      setSuccessMessage('');
      const { email, password, name } = value;

      // Validate form fields
      const errors: string[] = [];

      // Validate name
      if (!name) {
        errors.push('Name is required');
      } else if (name.length < 2) {
        errors.push('Name must be at least 2 characters long');
      } else if (name.length > 50) {
        errors.push('Name must be less than 50 characters');
      } else if (!/^[a-zA-Z\s'-]+$/.test(name)) {
        errors.push('Name can only contain letters, spaces, hyphens, and apostrophes');
      }

      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email) {
        errors.push('Email is required');
      } else if (!emailRegex.test(email)) {
        errors.push('Please enter a valid email address');
      }

      // Validate password
      if (!password) {
        errors.push('Password is required');
      } else if (password.length < 8) {
        errors.push('Password must be at least 8 characters long');
      } else if (password.length > 128) {
        errors.push('Password must be less than 128 characters');
      } else if (!/(?=.*[a-z])/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
      } else if (!/(?=.*[A-Z])/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
      } else if (!/(?=.*\d)/.test(password)) {
        errors.push('Password must contain at least one number');
      } else if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(password)) {
        errors.push('Password must contain at least one symbol');
      }

      // Show validation errors if any
      if (errors.length > 0) {
        setError(errors.join('. '));
        return;
      }

      try {
        const result = await signUpWithFirstAdminServerFn({
          data: { email, password, name },
        });

        // Automatically sign in the user after successful registration
        try {
          const { data, error: signInError } = await signIn.email(
            {
              email: result.userCredentials.email,
              password,
              rememberMe: true,
            },
            {
              onSuccess: () => undefined,
              onError: () => undefined,
            },
          );

          if (signInError) {
            setSuccessMessage(`${result.message} Please sign in to continue.`);
            // Navigate to login after showing message
            setTimeout(() => {
              navigate({ to: '/login' });
            }, 2000);
            return;
          }

          if (data) {
            // Invalidate router to refresh auth state
            await router.invalidate();

            // Navigate to the app after showing success message
            setTimeout(() => {
              navigate({ to: '/app' });
            }, 2000);
          } else {
            throw new Error('Sign-in returned no data');
          }
        } catch (_signInError) {
          // Navigate to login after showing message
          setTimeout(() => {
            navigate({ to: '/login' });
          }, 2000);
        }
      } catch (error: unknown) {
        // Handle specific error messages
        // Only show "user exists" if we get the explicit error code from Better Auth
        if (
          (error as { code?: string })?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' ||
          (error instanceof Error &&
            error.message?.includes('User already exists') &&
            (error as { code?: string })?.code !== 'FAILED_TO_CREATE_USER')
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

  // Get current email value for navigation links
  const [currentEmail, setCurrentEmail] = useState(emailFromQuery || '');

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void navigate({ to: '/app', replace: true });
  }, [isAuthenticated, navigate]);

  if (isPending || isAuthenticated) {
    return <AuthSkeleton />;
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
            Create your account
          </h2>
          {isFirstUser && (
            <div className="mt-4 bg-card border border-border rounded-md p-4">
              <div className="flex">
                <div className="shrink-0">
                  <Crown className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-card-foreground">
                    Administrator Account
                  </h3>
                  <div className="mt-2 text-sm text-muted-foreground">
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
              <div className="h-4 bg-muted rounded w-3/4 mx-auto"></div>
              <div className="space-y-4">
                <div className="h-10 bg-muted rounded"></div>
                <div className="h-10 bg-muted rounded"></div>
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
            {successMessage && (
              <div className="bg-primary/10 border border-primary/20 text-primary px-4 py-3 rounded">
                {successMessage}
                {successMessage.includes('Admin') && (
                  <div className="mt-2 text-sm flex items-center">
                    <ShieldCheck className="h-4 w-4 mr-1" />
                    You have been granted administrator privileges as the first user!
                  </div>
                )}
              </div>
            )}
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel className="sr-only">Full Name</FieldLabel>
                  <InputGroup>
                    <InputGroupIcon>
                      <User />
                    </InputGroupIcon>
                    <InputGroupInput
                      id={nameId}
                      name={field.name}
                      type="text"
                      required
                      placeholder="Full name"
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
                      autoComplete="new-password"
                      placeholder="Password"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </InputGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  )}
                  {!field.state.meta.errors.length && field.state.value && (
                    <div className="text-xs text-muted-foreground">
                      Password must contain: 8+ characters, uppercase, lowercase, number, and symbol
                    </div>
                  )}
                </Field>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit} className="w-full">
                  {isSubmitting ? 'Creating account...' : 'Create account'}
                </Button>
              )}
            </form.Subscribe>
            <div className="text-center">
              <Link
                to="/login"
                search={
                  currentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)
                    ? { email: currentEmail }
                    : {}
                }
                className="font-medium hover:text-muted-foreground"
              >
                Already have an account? Sign in
              </Link>
            </div>
          </form>
        </ClientOnly>
      </div>
    </div>
  );
}
