import type { BetterAuthOptions } from 'better-auth';
import { createSharedBetterAuthOptions } from './sharedOptions';

export const options = {
  ...createSharedBetterAuthOptions({
    sendResetPassword: async () => {},
    sendVerificationEmail: async () => {},
    sendInvitationEmail: async () => {},
  }),
} satisfies BetterAuthOptions;
