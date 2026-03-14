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

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}
