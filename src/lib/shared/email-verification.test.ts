import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT,
  isEmailVerificationRequiredForUser,
  parseTimestampLike,
  resolveEmailVerificationEnforcedAt,
} from '~/lib/shared/email-verification';

describe('email verification rollout helper', () => {
  it('parses timestamps from ISO strings and numbers', () => {
    const timestamp = Date.parse('2026-03-14T00:00:00.000Z');

    expect(parseTimestampLike('2026-03-14T00:00:00.000Z')).toBe(timestamp);
    expect(parseTimestampLike(timestamp)).toBe(timestamp);
  });

  it('falls back to the default enforcement timestamp when config is missing', () => {
    expect(resolveEmailVerificationEnforcedAt()).toBe(DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT);
    expect(DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT).toBe(0);
  });

  it('requires verification for users created after the rollout when they are still unverified', () => {
    expect(
      isEmailVerificationRequiredForUser({
        createdAt: '2026-03-15T00:00:00.000Z',
        emailVerified: false,
      }),
    ).toBe(true);
  });

  it('grandfathers users created before the rollout cutoff when an enforcement timestamp is set', () => {
    expect(
      isEmailVerificationRequiredForUser({
        createdAt: '2026-03-13T00:00:00.000Z',
        emailVerified: false,
        enforcedAt: Date.parse('2026-03-14T00:00:00.000Z'),
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
