import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, Navigate, useRouter } from '@tanstack/react-router';
import { CheckCircle2, Lock } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import { authClient } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import {
  markCurrentUserOnboardingCompleteServerFn,
  resolvePasswordResetEmailServerFn,
} from '~/features/auth/server/onboarding';

export const Route = createFileRoute('/reset-password')({
  staticData: true,
  component: ResetPasswordPage,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    token: z.string().min(1, 'Reset token is required').optional(),
  }),
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const authState = useAuthState();
  const { user } = useAuth({ fetchRole: authState.isAuthenticated }); // Only fetch when authenticated
  const session = useMemo(
    () => ({ user: authState.isAuthenticated ? user : null }),
    [user, authState.isAuthenticated],
  );
  const router = useRouter();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const newPasswordId = useId();
  const confirmPasswordId = useId();

  const form = useForm({
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
    onSubmit: async ({ value }) => {
      setError('');

      // Validate form fields
      const errors: string[] = [];

      // Validate password
      if (!value.password) {
        errors.push('Password is required');
      } else if (value.password.length < 8) {
        errors.push('Password must be at least 8 characters long');
      } else if (value.password.length > 128) {
        errors.push('Password must be less than 128 characters');
      } else if (!/(?=.*[a-z])/.test(value.password)) {
        errors.push('Password must contain at least one lowercase letter');
      } else if (!/(?=.*[A-Z])/.test(value.password)) {
        errors.push('Password must contain at least one uppercase letter');
      } else if (!/(?=.*\d)/.test(value.password)) {
        errors.push('Password must contain at least one number');
      } else if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(value.password)) {
        errors.push('Password must contain at least one symbol');
      }

      // Validate password confirmation
      if (!value.confirmPassword) {
        errors.push('Please confirm your password');
      } else if (value.confirmPassword !== value.password) {
        errors.push('Passwords do not match');
      }

      // Show validation errors if any
      if (errors.length > 0) {
        setError(errors.join('. '));
        return;
      }

      if (!token) {
        setError('Invalid or missing reset token. Please request a new password reset.');
        return;
      }

      try {
        const resetEmail = await resolvePasswordResetEmailServerFn({
          data: { token },
        });

        if (!resetEmail.found) {
          throw new Error('Password was reset, but the follow-up sign-in context was unavailable.');
        }

        // Reset the password using Better Auth client.
        await authClient.resetPassword({
          token,
          newPassword: value.password,
          fetchOptions: { throw: true },
        });

        try {
          await authClient.signIn.email({
            email: resetEmail.email,
            password: value.password,
            fetchOptions: { throw: true },
          });
        } catch (signInError) {
          const message =
            signInError instanceof Error ? signInError.message.toLowerCase() : String(signInError);

          if (message.includes('email not verified') || message.includes('verify your email')) {
            await router.navigate({
              to: '/account-setup',
              search: {
                email: resetEmail.email,
                redirectTo: '/app',
              },
              replace: true,
            });
            return;
          }

          throw signInError;
        }

        await markCurrentUserOnboardingCompleteServerFn();

        setSuccess(true);

        await router.invalidate();

        // Navigate to the app after showing success message
        setTimeout(() => {
          void router.navigate({ to: '/app' });
        }, 2000);
      } catch (error: unknown) {
        const errorObj = error as {
          code?: string;
          error?: { code?: string; message?: string };
          message?: string;
          status?: number;
        };
        const errorMessage = errorObj?.message || errorObj?.error?.message || '';
        const errorCode = errorObj?.code || errorObj?.error?.code || '';

        if (
          errorMessage.toLowerCase().includes('invalid token') ||
          errorMessage.toLowerCase().includes('expired') ||
          errorMessage.toLowerCase().includes('invalid or expired') ||
          errorCode === 'INVALID_TOKEN' ||
          errorCode === 'TOKEN_EXPIRED'
        ) {
          setError(
            'This password reset link has expired or is invalid. Please request a new password reset.',
          );
        } else if (errorMessage.includes('Password')) {
          setError('Password does not meet the requirements. Please check the password criteria.');
        } else {
          setError('Password reset failed. Please try again or request a new reset link.');
        }
      }
    },
  });

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset.');
      return;
    }
    // Token validation is handled by Better Auth internally
  }, [token]);

  // Check if user is already logged in after password reset
  useEffect(() => {
    if (session?.user && success) {
      setTimeout(() => {
        void router.navigate({ to: '/app' });
      }, 1000);
    }
  }, [session, success, router]);

  if (!success) {
    if (authState.isPending) {
      return <AuthSkeleton />;
    }

    if (authState.isAuthenticated) {
      return <Navigate to="/app" replace />;
    }
  }

  if (success) {
    return (
      <AuthRouteShell>
        <Card className="w-full max-w-sm">
          <CardContent className="space-y-4 px-8 py-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-7 w-7 text-primary" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">Password Reset Successful</h2>
              <p className="text-sm text-muted-foreground">
                Your password has been updated, and you are now signed in. You will be redirected to
                your dashboard.
              </p>
            </div>
          </CardContent>
        </Card>
      </AuthRouteShell>
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
            Reset your password
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Enter your new password below
          </p>
        </div>
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

          <form.Field name="password">
            {(field) => (
              <Field>
                <FieldLabel className="sr-only">New Password</FieldLabel>
                <InputGroup>
                  <InputGroupIcon>
                    <Lock />
                  </InputGroupIcon>
                  <InputGroupInput
                    id={newPasswordId}
                    name={field.name}
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="New password"
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

          <form.Field name="confirmPassword">
            {(field) => (
              <Field>
                <FieldLabel className="sr-only">Confirm New Password</FieldLabel>
                <InputGroup>
                  <InputGroupIcon>
                    <Lock />
                  </InputGroupIcon>
                  <InputGroupInput
                    id={confirmPasswordId}
                    name={field.name}
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="Confirm new password"
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
              <Button type="submit" disabled={!canSubmit || !token} className="w-full">
                {isSubmitting ? 'Resetting password...' : 'Reset password'}
              </Button>
            )}
          </form.Subscribe>

          <div className="text-center">
            <Link to="/login" className="font-medium  hover:text-muted-foreground">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
