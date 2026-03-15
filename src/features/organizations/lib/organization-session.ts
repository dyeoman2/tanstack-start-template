import type { QueryClient } from '@tanstack/react-query';
import { authClient } from '~/features/auth/auth-client';

export async function refreshOrganizationClientState(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  options: {
    invalidateRouter?: () => Promise<unknown>;
  } = {},
) {
  authClient.$store.notify('$activeOrgSignal');
  authClient.$store.notify('$sessionSignal');

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['session'] }),
    queryClient.invalidateQueries({ queryKey: ['organizations'] }),
    queryClient.invalidateQueries({ queryKey: ['active-organization'] }),
    queryClient.invalidateQueries({ queryKey: ['user-invitations'] }),
    options.invalidateRouter?.(),
  ]);
}

/**
 * Extract the human-readable message from an error thrown by a server function
 * that wraps a Convex mutation/action. Raw ConvexError payloads propagated
 * through TanStack Start server functions include the full JSON payload and a
 * stack trace — this strips the noise and returns just the message.
 */
export function getServerFunctionErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) {
    return fallback;
  }

  if (error.message.includes('ConvexError')) {
    const match = error.message.match(/"message"\s*:\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
  }

  return error.message;
}

export function getOrganizationActionErrorMessage(error: unknown, fallbackMessage: string) {
  const errorCode =
    error instanceof Error &&
    'code' in error &&
    typeof (error as Error & { code?: unknown }).code === 'string'
      ? ((error as Error & { code: string }).code as string)
      : undefined;
  if (errorCode === 'EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION') {
    return 'Verify your email address before responding to this invitation.';
  }

  return getServerFunctionErrorMessage(error, fallbackMessage);
}
