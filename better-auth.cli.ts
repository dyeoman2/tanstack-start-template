import { betterAuth } from 'better-auth';
import { getOptions } from './convex/betterAuth/options';

if (!process.env.BETTER_AUTH_URL) {
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';
}

if (!process.env.BETTER_AUTH_SECRET) {
  process.env.BETTER_AUTH_SECRET = 'better-auth-cli-placeholder-secret-1234';
}

// The Better Auth CLI expects a concrete auth export. Keep that requirement in
// this tooling-only module so Convex deployment code never analyzes it as part
// of the runtime function bundle.
export const auth = betterAuth(getOptions({ cli: true }));

export default auth;
