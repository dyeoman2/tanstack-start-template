import { describe, expect, it } from 'vitest';
import { getTwoFactorRedirectHref } from './auth-client';

describe('getTwoFactorRedirectHref', () => {
  it('preserves redirectTo when sending the user to the two-factor route', () => {
    expect(
      getTwoFactorRedirectHref('http://127.0.0.1:3000/login?redirectTo=%2Fapp%2Fadmin'),
    ).toBe('/two-factor?redirectTo=%2Fapp%2Fadmin');
  });

  it('returns the bare two-factor route when there is no redirect target', () => {
    expect(getTwoFactorRedirectHref('http://127.0.0.1:3000/login')).toBe('/two-factor');
  });
});
