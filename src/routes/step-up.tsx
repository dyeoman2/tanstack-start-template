import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate, useRouter } from '@tanstack/react-router';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { AuthSkeleton } from '~/components/AuthSkeleton';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { authClient, refreshAuthClientSession } from '~/features/auth/auth-client';
import { AuthRouteShell } from '~/features/auth/components/AuthRouteShell';
import { getBetterAuthUserFacingMessage } from '~/features/auth/lib/better-auth-client-error';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { STEP_UP_REQUIREMENTS } from '~/lib/shared/auth-policy';

export const Route = createFileRoute('/step-up')({
  staticData: true,
  component: StepUpPage,
  errorComponent: () => <div>Something went wrong</div>,
  pendingComponent: AuthSkeleton,
  validateSearch: z.object({
    challengeId: z.string().uuid(),
  }),
});

function getRequirementMessage(
  requirement: (typeof STEP_UP_REQUIREMENTS)[keyof typeof STEP_UP_REQUIREMENTS],
) {
  switch (requirement) {
    case STEP_UP_REQUIREMENTS.accountEmailChange:
      return 'Verify your account again before changing your sign-in email address.';
    case STEP_UP_REQUIREMENTS.auditExport:
      return 'Verify your account again before exporting regulated audit records.';
    case STEP_UP_REQUIREMENTS.attachmentAccess:
      return 'Verify your account again before issuing a file access link.';
    case STEP_UP_REQUIREMENTS.sessionAdministration:
      return 'Verify your account again before managing user sessions.';
    case STEP_UP_REQUIREMENTS.userAdministration:
      return 'Verify your account again before managing users.';
    default:
      return 'Verify your account again before continuing with this privileged action.';
  }
}

function StepUpPage() {
  const { challengeId } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);
  const challenge = useQuery(api.stepUp.getCurrentChallenge, { challengeId });
  const redirectTarget = challenge?.redirectTo ?? '/app';

  if (isPending || challenge === undefined) {
    return <AuthSkeleton />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        replace
        to="/login"
        search={{
          redirectTo: `/step-up?challengeId=${encodeURIComponent(challengeId)}`,
        }}
      />
    );
  }

  if (challenge === null) {
    return (
      <AuthRouteShell>
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle className="text-3xl">Verification expired</CardTitle>
            <CardDescription>
              This verification challenge is no longer valid. Start the protected action again.
            </CardDescription>
          </CardHeader>
        </Card>
      </AuthRouteShell>
    );
  }

  async function prepareStepUpCookie() {
    const response = await fetch('/api/auth/step-up', {
      body: JSON.stringify({
        challengeId,
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Unable to prepare the verification challenge.');
    }
  }

  async function handlePasskeyVerification() {
    setError('');
    setIsPasskeyPending(true);

    try {
      await prepareStepUpCookie();
      await authClient.signIn.passkey({
        fetchOptions: { throw: true },
      });
      await refreshAuthClientSession(queryClient);
      await router.invalidate();
      router.history.replace(redirectTarget);
    } catch (stepUpError) {
      setError(
        getBetterAuthUserFacingMessage(stepUpError, {
          fallback: 'Unable to verify with a passkey right now.',
        }),
      );
    } finally {
      setIsPasskeyPending(false);
    }
  }

  return (
    <AuthRouteShell>
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-3xl">Verify Your Account</CardTitle>
          <CardDescription>{getRequirementMessage(challenge.requirement)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Button
            className="w-full justify-start gap-2"
            disabled={isPasskeyPending}
            onClick={() => {
              void handlePasskeyVerification();
            }}
            size="lg"
          >
            <Fingerprint className="size-4" />
            {isPasskeyPending ? 'Waiting for passkey…' : 'Verify with passkey'}
          </Button>

          <Button asChild className="w-full justify-start gap-2" size="lg" variant="outline">
            <Link search={{ challengeId }} to="/two-factor">
              <ShieldCheck className="size-4" />
              Verify with authenticator app
            </Link>
          </Button>
        </CardContent>
      </Card>
    </AuthRouteShell>
  );
}
