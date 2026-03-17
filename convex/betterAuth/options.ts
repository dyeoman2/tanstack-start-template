import type { BetterAuthOptions } from 'better-auth';
import { createSharedBetterAuthOptions } from './sharedOptions';

export type BetterAuthOptionsMode = 'runtime' | 'tooling';

export function getOptions(mode: BetterAuthOptionsMode = 'runtime'): BetterAuthOptions {
  const includeRuntimeEnvConfig = mode === 'tooling';

  return {
    ...createSharedBetterAuthOptions(
      {
        sendChangeEmailConfirmation: async () => {},
        sendResetPassword: async () => {},
        sendVerificationEmail: async () => {},
        sendInvitationEmail: async () => {},
      },
      {
        includeRuntimeEnvConfig,
      },
    ),
  } satisfies BetterAuthOptions;
}
