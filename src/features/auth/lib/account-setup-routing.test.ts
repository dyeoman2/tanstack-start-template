import { describe, expect, it } from 'vitest';
import {
  getAccountSetupCallbackUrl,
  getAccountSetupHref,
  normalizeAppRedirectTarget,
} from './account-setup-routing';

describe('account setup routing helpers', () => {
  it('normalizes unsupported redirect targets to /app', () => {
    expect(normalizeAppRedirectTarget('/somewhere-else')).toBe('/app');
    expect(normalizeAppRedirectTarget('https://example.com/app/admin')).toBe('/app');
  });

  it('builds account setup hrefs with preserved redirect intent', () => {
    expect(
      getAccountSetupHref({
        email: 'user@example.com',
        redirectTo: '/app/admin',
        verified: true,
      }),
    ).toBe('/account-setup?email=user%40example.com&redirectTo=%2Fapp%2Fadmin&verified=success');
  });

  it('builds account setup callbacks with a normalized redirect target', () => {
    expect(
      getAccountSetupCallbackUrl('http://127.0.0.1:3000', {
        redirectTo: '/not-allowed',
      }),
    ).toBe('http://127.0.0.1:3000/account-setup?verified=success');
  });
});
