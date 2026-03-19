export const APP_REDIRECT_TARGETS = [
  '/app',
  '/app/profile',
  '/app/admin',
  '/app/admin/users',
  '/app/admin/stats',
] as const;

export type AppRedirectTarget = (typeof APP_REDIRECT_TARGETS)[number];

export function normalizeAppRedirectTarget(value?: string | null): AppRedirectTarget {
  if (!value) {
    return '/app';
  }

  const [path] = value.split('?');
  const match = APP_REDIRECT_TARGETS.find((route) => route === path);

  return (match ?? '/app') as AppRedirectTarget;
}

export function getAccountSetupHref(options?: {
  email?: string | null;
  redirectTo?: string | null;
  verified?: boolean;
}) {
  const searchParams = new URLSearchParams();
  const redirectTo = normalizeAppRedirectTarget(options?.redirectTo);

  if (options?.email) {
    searchParams.set('email', options.email);
  }

  if (redirectTo !== '/app') {
    searchParams.set('redirectTo', redirectTo);
  }

  if (options?.verified) {
    searchParams.set('verified', 'success');
  }

  const search = searchParams.toString();
  return `/account-setup${search ? `?${search}` : ''}`;
}

export function getAccountSetupCallbackUrl(
  origin: string,
  options?: { redirectTo?: string | null },
) {
  return new URL(
    getAccountSetupHref({
      redirectTo: options?.redirectTo,
      verified: true,
    }),
    origin,
  ).toString();
}
