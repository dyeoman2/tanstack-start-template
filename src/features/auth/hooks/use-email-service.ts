import { useQuery } from '@tanstack/react-query';
import { SYSTEM_KEYS } from '~/lib/query-keys';
import { checkEmailServiceConfiguredServerFn } from '~/lib/server/email/resend.server';

export function useEmailService() {
  return useQuery({
    queryKey: SYSTEM_KEYS.EMAIL_SERVICE,
    queryFn: () => checkEmailServiceConfiguredServerFn(),
    staleTime: 5 * 60 * 1000, // 5 minutes - this is configuration that doesn't change often
  });
}
