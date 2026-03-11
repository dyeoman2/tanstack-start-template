import { convexAdapter } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { BetterAuthOptions } from 'better-auth';
import { admin } from 'better-auth/plugins';
import authConfig from '../auth.config';

export const options = {
  database: convexAdapter({} as never, {} as never),
  rateLimit: {
    storage: 'database',
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
    sendResetPassword: async () => {},
  },
  user: {
    additionalFields: {
      phoneNumber: {
        type: 'string',
        required: false,
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
    convex({
      authConfig,
      jwks: process.env.JWKS,
      options: {
        basePath: '/api/auth',
      },
    }),
  ],
} satisfies BetterAuthOptions;
