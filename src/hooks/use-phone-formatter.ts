import { useCallback, useState } from 'react';

/**
 * Hook for formatting phone numbers to (XXX) XXX-XXXX format
 * Handles input changes and formats the value as the user types
 */
export function usePhoneFormatter(initialValue: string = '') {
  const [value, setValue] = useState(initialValue);

  const formatPhoneNumber = useCallback((input: string): string => {
    // Remove all non-numeric characters
    const cleaned = input.replace(/\D/g, '');

    // Limit to 10 digits
    const limited = cleaned.substring(0, 10);

    // Format as (XXX) XXX-XXXX
    if (limited.length >= 6) {
      return `(${limited.substring(0, 3)}) ${limited.substring(3, 6)}-${limited.substring(6)}`;
    } else if (limited.length >= 3) {
      return `(${limited.substring(0, 3)}) ${limited.substring(3)}`;
    } else if (limited.length > 0) {
      return `(${limited}`;
    }

    return limited;
  }, []);

  const handleChange = useCallback(
    (input: string) => {
      // Extract raw digits first to handle already-formatted input
      const cleaned = input.replace(/\D/g, '');
      const formatted = formatPhoneNumber(cleaned);
      setValue(formatted);
      return formatted;
    },
    [formatPhoneNumber],
  );

  const formatInput = useCallback(
    (input: string) => {
      // Simple formatter that doesn't update internal state
      const cleaned = input.replace(/\D/g, '');
      return formatPhoneNumber(cleaned);
    },
    [formatPhoneNumber],
  );

  const setPhoneValue = useCallback(
    (newValue: string) => {
      // Extract raw digits first to handle already-formatted input
      const cleaned = newValue.replace(/\D/g, '');
      const formatted = formatPhoneNumber(cleaned);
      setValue(formatted);
    },
    [formatPhoneNumber],
  );

  const getRawValue = useCallback(() => {
    // Return just the numeric digits for storage/validation
    return value.replace(/\D/g, '');
  }, [value]);

  return {
    value,
    setValue: setPhoneValue,
    handleChange,
    formatInput,
    getRawValue,
  };
}
