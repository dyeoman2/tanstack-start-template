import { describe, expect, it } from 'vitest';
import { getBetterAuthUserFacingMessage } from './better-auth-client-error';

describe('getBetterAuthUserFacingMessage', () => {
  it('maps nested API error message that is only an HTTP status to a server message', () => {
    expect(
      getBetterAuthUserFacingMessage({
        error: { message: '500' },
      }),
    ).toMatch(/couldn't reach the sign-in service/i);
  });

  it('extracts support reference from Convex-style server error code strings', () => {
    const message = getBetterAuthUserFacingMessage({
      code: '[Request ID: 4aa0b17a1ac0411e] Server Error',
    });
    expect(message).toContain('4aa0b17a1ac0411e');
    expect(message).toMatch(/sign-in service/i);
  });

  it('passes through credential errors when not normalizing', () => {
    expect(
      getBetterAuthUserFacingMessage({
        error: { message: 'Invalid email or password' },
      }),
    ).toBe('Invalid email or password');
  });

  it('normalizes sign-in failures to one message when invalidPasswordSignInCopy is set', () => {
    const opts = { invalidPasswordSignInCopy: 'Incorrect email or password.' as const };
    expect(getBetterAuthUserFacingMessage({ error: { message: 'User not found' } }, opts)).toBe(
      'Incorrect email or password.',
    );
    expect(
      getBetterAuthUserFacingMessage({ error: { message: 'Invalid email or password' } }, opts),
    ).toBe('Incorrect email or password.');
  });

  it('does not normalize enterprise routing errors as credential failures', () => {
    expect(
      getBetterAuthUserFacingMessage(
        { error: { message: 'Password sign-in is disabled for this organization' } },
        { invalidPasswordSignInCopy: 'Incorrect email or password.' },
      ),
    ).toBe('Password sign-in is disabled for this organization');
  });

  it('normalizes OTP failures when invalidOtpCopy is set', () => {
    expect(
      getBetterAuthUserFacingMessage(
        { error: { message: 'Invalid TOTP code' } },
        { invalidOtpCopy: 'That code is not valid. Try again.' },
      ),
    ).toBe('That code is not valid. Try again.');
  });

  it('uses fallback when nothing is parseable', () => {
    expect(getBetterAuthUserFacingMessage(null, { fallback: 'Custom fallback' })).toBe(
      'Custom fallback',
    );
  });

  it('uses server message when status is 500 and body has no message', () => {
    expect(getBetterAuthUserFacingMessage({ status: 500 }, { fallback: 'fallback' })).toMatch(
      /sign-in service/i,
    );
  });

  it('maps rate limit text', () => {
    expect(
      getBetterAuthUserFacingMessage({
        error: { message: 'Too many requests' },
      }),
    ).toMatch(/too many attempts/i);
  });
});
