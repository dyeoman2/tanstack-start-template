import type { AuthConfig } from 'convex/server';
import { resolveAuthConfigProvider } from './betterAuth/staticJwks';

export default {
  providers: [resolveAuthConfigProvider(process.env.JWKS)],
} satisfies AuthConfig;
