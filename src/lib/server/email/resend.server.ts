import { api } from '@convex/_generated/api';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createServerFn } from '@tanstack/react-start';

// No auth cookies needed for unauthenticated endpoints
const noAuthCookieGetter = () => undefined;

// Check if email service is configured (used by forgot password page)
// Now queries Convex to check email configuration since emails are sent from Convex
export const checkEmailServiceConfiguredServerFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const { fetchQuery } = await setupFetchClient(createAuth, noAuthCookieGetter);
  const result = await fetchQuery(api.emails.checkEmailServiceConfigured, {});
  return result;
});
