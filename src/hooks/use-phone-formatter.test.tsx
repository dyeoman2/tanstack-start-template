import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePhoneFormatter } from '~/hooks/use-phone-formatter';

describe('usePhoneFormatter', () => {
  it('formats the initial value through the setter path', () => {
    const { result } = renderHook(() => usePhoneFormatter());

    act(() => {
      result.current.setValue('1234567890');
    });

    expect(result.current.value).toBe('(123) 456-7890');
    expect(result.current.getRawValue()).toBe('1234567890');
  });

  it('formats user input and trims to 10 digits', () => {
    const { result } = renderHook(() => usePhoneFormatter());

    let formatted = '';
    act(() => {
      formatted = result.current.handleChange('123-456-7890123');
    });

    expect(formatted).toBe('(123) 456-7890');
    expect(result.current.value).toBe('(123) 456-7890');
  });

  it('formats partial input without updating state when using formatInput', () => {
    const { result } = renderHook(() => usePhoneFormatter('555'));

    expect(result.current.formatInput('12345')).toBe('(123) 45');
    expect(result.current.value).toBe('555');
  });
});
