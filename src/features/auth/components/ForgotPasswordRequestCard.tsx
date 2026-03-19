import { Link } from '@tanstack/react-router';
import { Loader2, Mail } from 'lucide-react';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { authClient } from '~/features/auth/auth-client';
import { getBetterAuthUserFacingMessage } from '~/features/auth/lib/better-auth-client-error';

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function validateEmail(value: string) {
  const normalized = normalizeEmail(value);

  if (!normalized) {
    return 'Email is required.';
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(normalized)) {
    return 'Please enter a valid email address.';
  }

  return null;
}

export function ForgotPasswordRequestCard({
  email,
  redirectTo,
}: {
  email?: string;
  redirectTo?: string;
}) {
  const [emailValue, setEmailValue] = useState(email ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null);

  const normalizedRequestedEmail = useMemo(
    () => (requestedEmail ? normalizeEmail(requestedEmail) : null),
    [requestedEmail],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationMessage = validateEmail(emailValue);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await authClient.requestPasswordReset({
        email: normalizeEmail(emailValue),
        redirectTo: '/reset-password',
        fetchOptions: { throw: true },
      });
      setRequestedEmail(emailValue);
    } catch (error) {
      setError(
        getBetterAuthUserFacingMessage(error, {
          fallback: 'Unable to request a password reset. Please try again.',
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (normalizedRequestedEmail) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl">Check your email</CardTitle>
          <CardDescription>
            If an account exists for {normalizedRequestedEmail}, a password reset link has been
            sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
            Open the email and follow the link to choose a new password.
          </div>

          <div className="flex flex-col gap-3">
            <Button type="button" variant="outline" onClick={() => setRequestedEmail(null)}>
              Send another reset link
            </Button>
            <div className="text-center text-sm">
              <Link
                to="/login"
                search={{
                  email: normalizedRequestedEmail,
                  ...(redirectTo ? { redirectTo } : {}),
                }}
                className="font-medium underline underline-offset-4 hover:text-muted-foreground"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-3xl">Forgot password</CardTitle>
        <CardDescription>Enter your email to receive a password reset link.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="forgot-password-email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <Input
              id="forgot-password-email"
              type="email"
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              value={emailValue}
              onChange={(event) => setEmailValue(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Send reset link
          </Button>
        </form>

        <div className="text-center text-sm">
          <Link
            to="/login"
            search={{
              ...(emailValue.trim().length > 0 ? { email: normalizeEmail(emailValue) } : {}),
              ...(redirectTo ? { redirectTo } : {}),
            }}
            className="font-medium underline underline-offset-4 hover:text-muted-foreground"
          >
            Back to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
