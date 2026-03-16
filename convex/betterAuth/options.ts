import type { BetterAuthOptions } from 'better-auth';
import { getBetterAuthSecret } from '../../src/lib/server/env.server';
import { createSharedBetterAuthOptions } from './sharedOptions';

function shouldIncludeRuntimeEnvConfig(ctx: unknown): boolean {
  if (!ctx || typeof ctx !== 'object') {
    return false;
  }

  return Object.keys(ctx).length > 0;
}

export function getOptions(ctx?: unknown): BetterAuthOptions {
  const includeRuntimeEnvConfig = shouldIncludeRuntimeEnvConfig(ctx);

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
    ...(includeRuntimeEnvConfig ? { secret: getBetterAuthSecret() } : {}),
  } satisfies BetterAuthOptions;
}
