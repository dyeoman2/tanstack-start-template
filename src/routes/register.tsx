import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { ClientOnly } from '~/components/ClientOnly';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import { authClient } from '~/features/auth/auth-client';
import { getBetterAuthUserFacingMessage } from '~/features/auth/lib/better-auth-client-error';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import {
  getAccountSetupCallbackUrl,
  getAccountSetupHref,
} from '~/features/auth/lib/account-setup-routing';
import { bootstrapSignedUpUserServerFn } from '~/features/auth/server/user-management';

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
    redirectTo: z.string().regex(/^\/.*/).optional(),
  }),
});

function RegisterPage() {
  const { email: emailFromQuery, redirectTo } = Route.useSearch();
  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const passwordId = `${uid}-password`;
  const { isAuthenticated, isPending } = useAuthState();
  const navigate = useNavigate();

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
        const callbackURL =
          typeof window === 'undefined'
            ? undefined
            : getAccountSetupCallbackUrl(window.location.origin, { redirectTo });

        const signUpResult = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL,
          fetchOptions: {
            throw: true,
          },
        });

        try {
          const bootstrapResult = await bootstrapSignedUpUserServerFn({
            data: {
              authUserId: signUpResult.user.id,
              email: signUpResult.user.email,
            },
          });

          setSuccessMessage(bootstrapResult.message);
          setTimeout(() => {
            if (typeof window === 'undefined') {
              return;
            }

            window.location.assign(
              getAccountSetupHref({
                email,
                redirectTo,
              }),
            );
          }, 1200);
        } catch {
          setError(
            'Your account may have been created, but setup did not finish cleanly. Sign in with this email to resume account setup.',
          );
          setTimeout(() => {
            void navigate({
              to: '/login',
              search: {
                email,
                ...(redirectTo ? { redirectTo } : {}),
              },
            });
          }, 1600);
        }
      } catch (error: unknown) {
        if (import.meta.env.DEV) {
          console.error('[Register] signUp.email failed:', error);
        }

        const message = getBetterAuthUserFacingMessage(error, {
          fallback: 'Unable to create your account. Check your details and try again.',
        });

        if (
          message === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' ||
          message.toLowerCase().includes('already exists')
        ) {
          setError('An account with this email already exists. Sign in or use a different email.');
          return;
        }

        setError(message);
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
          <p className="mt-2 text-center text-sm text-muted-foreground">
            After signup, you&apos;ll verify your email and add a passkey or authenticator before
            entering the app.
          </p>
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
              void form.handleSubmit();
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
                search={{
                  ...(currentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentEmail)
                    ? { email: currentEmail }
                    : {}),
                  ...(redirectTo ? { redirectTo } : {}),
                }}
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
