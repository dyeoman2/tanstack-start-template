import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '~/lib/query-keys';
import { checkEmailServiceConfiguredServerFn } from '~/lib/server/email/resend.server';

export function useEmailService() {
  return useQuery({
    queryKey: queryKeys.system.emailService(),
    queryFn: () => checkEmailServiceConfiguredServerFn(),
    staleTime: 5 * 60 * 1000, // 5 minutes - this is configuration that doesn't change often
  });
}
