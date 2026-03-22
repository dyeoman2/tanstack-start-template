import { useCallback, useState } from 'react';

export function getPhoneDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 10);
}

export function formatPhoneNumber(input: string): string {
  const digits = getPhoneDigits(input);

  if (digits.length >= 6) {
    return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
  }

  if (digits.length >= 3) {
    return `(${digits.substring(0, 3)}) ${digits.substring(3)}`;
  }

  if (digits.length > 0) {
    return `(${digits}`;
  }

  return '';
}

/**
 * Hook for formatting phone numbers to (XXX) XXX-XXXX format
 * Handles input changes and formats the value as the user types
 */
export function usePhoneFormatter(initialValue: string = '') {
  const [value, setValue] = useState(initialValue);

  const handleChange = useCallback((input: string) => {
    const formatted = formatPhoneNumber(input);
    setValue(formatted);
    return formatted;
  }, []);

  const formatInput = useCallback((input: string) => formatPhoneNumber(input), []);

  const setPhoneValue = useCallback((newValue: string) => {
    setValue(formatPhoneNumber(newValue));
  }, []);

  const getRawValue = useCallback(() => {
    return getPhoneDigits(value);
  }, [value]);

  return {
    value,
    setValue: setPhoneValue,
    handleChange,
    formatInput,
    getRawValue,
  };
}
