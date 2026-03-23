import { describe, expect, it } from 'vitest';
import {
  isEmailVerificationRequiredForUser,
  parseTimestampLike,
} from '~/lib/shared/email-verification';

describe('email verification helper', () => {
  it('parses timestamps from ISO strings and numbers', () => {
    const timestamp = Date.parse('2026-03-14T00:00:00.000Z');

    expect(parseTimestampLike('2026-03-14T00:00:00.000Z')).toBe(timestamp);
    expect(parseTimestampLike(timestamp)).toBe(timestamp);
  });

  it('requires verification for unverified users with a valid createdAt timestamp', () => {
    expect(
      isEmailVerificationRequiredForUser({
        createdAt: '2026-03-15T00:00:00.000Z',
        emailVerified: false,
      }),
    ).toBe(true);
  });

  it('does not require verification when createdAt cannot be parsed', () => {
    expect(
      isEmailVerificationRequiredForUser({
        createdAt: '',
        emailVerified: false,
      }),
    ).toBe(false);
  });

  it('never requires verification for already verified users', () => {
    expect(
      isEmailVerificationRequiredForUser({
        createdAt: '2026-03-15T00:00:00.000Z',
        emailVerified: true,
      }),
    ).toBe(false);
  });
});
