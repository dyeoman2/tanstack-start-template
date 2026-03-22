import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePhoneFormatter } from '~/hooks/use-phone-formatter';

describe('usePhoneFormatter', () => {
  it('updates state through the setter and exposes a raw value', () => {
    const { result } = renderHook(() => usePhoneFormatter());

    act(() => {
      result.current.setValue('1234567890');
    });

    expect(result.current.value).toBe('(123) 456-7890');
    expect(result.current.getRawValue()).toBe('1234567890');
  });

  it('returns a formatted preview without mutating state', () => {
    const { result } = renderHook(() => usePhoneFormatter('555'));

    expect(result.current.formatInput('12345')).toBe('(123) 45');
    expect(result.current.value).toBe('555');
  });
});
