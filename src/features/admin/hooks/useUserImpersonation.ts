import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useToast } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';

export function useUserImpersonation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const impersonateUser = async (userId: string) => {
    setPendingUserId(userId);

    try {
      await authClient.admin.impersonateUser({
        userId,
        fetchOptions: { throw: true },
      });
      const session = await authClient.getSession({
        fetchOptions: { throw: true },
      });

      authClient.$store.notify('$sessionSignal');
      queryClient.setQueryData(['session'], session);
      await navigate({ to: '/app' });
      await router.invalidate();
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to impersonate user'), 'error');
    } finally {
      setPendingUserId(null);
    }
  };

  return {
    impersonateUser,
    pendingUserId,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
