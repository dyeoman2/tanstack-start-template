/**
 * Shared password complexity rules enforced on both client and server.
 *
 * NIST SP 800-63B recommends minimum 8 characters. We additionally require
 * mixed case, a digit, and a symbol to defend against credential-stuffing
 * attacks that rely on weak/common passwords.
 *
 * Breach checking is handled by the Better Auth `haveIBeenPwned()` plugin,
 * which uses the HIBP k-anonymity range API (free, no API key) to reject
 * passwords that appear in known data breaches.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

const RULES: ReadonlyArray<{
  test: (pw: string) => boolean;
  message: string;
}> = [
  {
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
  },
  {
    test: (pw) => pw.length <= PASSWORD_MAX_LENGTH,
    message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  },
  {
    test: (pw) => /[a-z]/.test(pw),
    message: 'Password must contain at least one lowercase letter',
  },
  {
    test: (pw) => /[A-Z]/.test(pw),
    message: 'Password must contain at least one uppercase letter',
  },
  {
    test: (pw) => /\d/.test(pw),
    message: 'Password must contain at least one number',
  },
  {
    test: (pw) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw),
    message: 'Password must contain at least one symbol',
  },
];

/**
 * Validate a password against all complexity rules.
 * Returns all failing rules at once so the UI can display them together.
 */
export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];
  for (const rule of RULES) {
    if (!rule.test(password)) {
      errors.push(rule.message);
    }
  }
  return { valid: errors.length === 0, errors };
}
