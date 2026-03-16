import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';

export const Route = createFileRoute('/recover-account')({
  staticData: true,
  component: RecoverAccountPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    redirectTo: z.string().optional(),
    totpURI: z.string().optional(),
  }),
});

function getErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null &&
    'message' in error.error &&
    typeof error.error.message === 'string'
  ) {
    return error.error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to verify backup code. Please try again.';
}

function RecoverAccountPage() {
  const { redirectTo, totpURI } = Route.useSearch();
  const router = useRouter();
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!code.trim()) {
      showToast('Enter one of your backup codes.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      await authClient.twoFactor.verifyBackupCode({
        code: code.trim(),
        fetchOptions: { throw: true },
      });

      await router.invalidate();
      await router.navigate({ to: redirectTo || '/app', replace: true });
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthRouteShell>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-3xl">Recover account</CardTitle>
          <CardDescription>
            Enter one of your saved backup codes to access your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="backup-code" className="text-sm font-medium text-foreground">
                Backup code
              </label>
              <Input
                id="backup-code"
                autoCapitalize="off"
                autoCorrect="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Pi2Kz-z453E"
              />
            </div>
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Verify backup code
            </Button>
          </form>

          <div className="text-center text-sm">
            <Link
              to="/two-factor"
              search={{
                ...(redirectTo ? { redirectTo } : {}),
                ...(totpURI ? { totpURI } : {}),
              }}
              className="font-medium underline underline-offset-4 hover:text-muted-foreground"
            >
              Back to two-factor
            </Link>
          </div>
        </CardContent>
      </Card>
    </AuthRouteShell>
  );
}
