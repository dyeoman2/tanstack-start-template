import { passkeyClient } from '@better-auth/passkey/client';
import { convexClient } from '@convex-dev/better-auth/client/plugins';
import {
  adminClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import {
  adminAccessControl,
  adminRole,
  organizationAccessControl,
  organizationAdminRole,
  organizationMemberRole,
  organizationOwnerRole,
  userRole,
} from '~/lib/shared/better-auth-access';
import type { getOptions } from '../../../convex/betterAuth/options';
import { normalizeAppRedirectTarget } from './lib/account-setup-routing';

export function getTwoFactorRedirectHref(currentHref: string): string {
  const currentUrl = new URL(currentHref);
  const nextUrl = new URL('/two-factor', currentUrl.origin);
  const redirectTo = normalizeAppRedirectTarget(currentUrl.searchParams.get('redirectTo'));

  if (redirectTo !== '/app') {
    nextUrl.searchParams.set('redirectTo', redirectTo);
  }

  return `${nextUrl.pathname}${nextUrl.search}`;
}

function navigateWithBrowser(href: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.history.pushState(window.history.state, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export const rawAuthClient = createAuthClient({
  plugins: [
    convexClient(),
    inferAdditionalFields<ReturnType<typeof getOptions>>(),
    adminClient({
      ac: adminAccessControl,
      roles: {
        admin: adminRole,
        user: userRole,
      },
    }),
    organizationClient({
      ac: organizationAccessControl,
      roles: {
        admin: organizationAdminRole,
        member: organizationMemberRole,
        owner: organizationOwnerRole,
      },
    }),
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect: async () => {
        if (typeof window === 'undefined') {
          return;
        }

        navigateWithBrowser(getTwoFactorRedirectHref(window.location.href));
      },
    }),
  ],
});
