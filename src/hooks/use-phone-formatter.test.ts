import { describe, expect, it } from 'vitest';
import { formatPhoneNumber, getPhoneDigits } from '~/hooks/use-phone-formatter';

describe('phone formatting helpers', () => {
  it('formats a 10-digit number', () => {
    expect(formatPhoneNumber('1234567890')).toBe('(123) 456-7890');
  });

  it('trims non-digits and extra input before formatting', () => {
    expect(formatPhoneNumber('123-456-7890123')).toBe('(123) 456-7890');
    expect(getPhoneDigits('(123) 456-7890123')).toBe('1234567890');
  });

  it('formats partial input incrementally', () => {
    expect(formatPhoneNumber('12')).toBe('(12');
    expect(formatPhoneNumber('12345')).toBe('(123) 45');
  });
});
