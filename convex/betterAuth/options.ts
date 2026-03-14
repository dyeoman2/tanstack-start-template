import type { BetterAuthOptions } from 'better-auth';
import { createSharedBetterAuthOptions } from './sharedOptions';

export function getOptions(): BetterAuthOptions {
  return {
    ...createSharedBetterAuthOptions({
      sendResetPassword: async () => {},
      sendVerificationEmail: async () => {},
      sendInvitationEmail: async () => {},
    }, {
      includeRuntimeEnvConfig: false,
    }),
  } satisfies BetterAuthOptions;
}
