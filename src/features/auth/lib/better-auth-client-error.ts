/**
 * Maps Better Auth / better-fetch errors to text that is safe and useful in the UI.
 * Production servers often respond with HTTP status as the message or a generic
 * "Server Error" plus an opaque request id — we surface a clear explanation instead.
 */
const HTTP_STATUS_ONLY = /^\d{3}$/;

function extractSupportReference(text: string): string | undefined {
  const match = text.match(/Request ID:\s*([a-f0-9]+)/i);
  return match?.[1];
}

function collectRawMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const nestedError = record.error;
    if (
      typeof nestedError === 'object' &&
      nestedError !== null &&
      'message' in nestedError &&
      typeof (nestedError as { message: unknown }).message === 'string'
    ) {
      const message = (nestedError as { message: string }).message.trim();
      if (message.length > 0) {
        return message;
      }
    }

    if (typeof record.code === 'string') {
      const code = record.code.trim();
      if (code.length > 0) {
        return code;
      }
    }

    if (typeof record.message === 'string') {
      const message = record.message.trim();
      if (message.length > 0) {
        return message;
      }
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return undefined;
}

function readHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode'] as const) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function serverProblemMessage(reference?: string): string {
  const base =
    "We couldn't reach the sign-in service right now. This is usually temporary — wait a moment and try again.";
  if (reference) {
    return `${base} If it keeps happening, contact support and mention reference ${reference}.`;
  }
  return `${base} If it keeps happening, contact support with the approximate time you tried.`;
}

/**
 * OWASP-style: one generic message for wrong email/password/unknown user so the UI does not
 * distinguish account existence from bad password. Only used when callers opt in (e.g. password sign-in).
 */
function isLikelyInvalidPasswordSignInFailure(lower: string): boolean {
  if (
    lower.includes('enterprise') ||
    lower.includes('password sign-in is disabled') ||
    (lower.includes('google') && lower.includes('workspace')) ||
    lower.includes('passkey') ||
    lower.includes('email not verified') ||
    lower.includes('verify your email') ||
    (lower.includes('not verified') && lower.includes('email'))
  ) {
    return false;
  }

  return (
    /(invalid|incorrect|wrong)\s+(email\s+or\s+password|credentials?|password|username\s+or\s+password)/.test(
      lower,
    ) ||
    /(email\s+or\s+password)\s+(is\s+)?(invalid|incorrect|wrong)/.test(lower) ||
    /\buser\s+not\s+found\b/.test(lower) ||
    /\b(no|unknown)\s+(user|account)\b/.test(lower) ||
    /\baccount\s+not\s+found\b/.test(lower) ||
    /\bauthentication\s+failed\b/.test(lower) ||
    /\b(sign|log)[\s-]?in\s+failed\b/.test(lower)
  );
}

/** Generic OTP failure copy (avoid implying whether the code was wrong vs expired when unclear). */
function isLikelyInvalidOtpFailure(lower: string): boolean {
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return false;
  }

  return (
    /\b(invalid|incorrect|wrong)\s+(code|otp|token|totp|one[-\s]?time|backup\s+code)\b/.test(
      lower,
    ) ||
    /\b(code|otp|token|backup\s+code)\s+(is\s+)?(invalid|incorrect|wrong|expired)\b/.test(lower) ||
    /\bverification\s+failed\b/.test(lower) ||
    /\b2fa\s+failed\b/.test(lower) ||
    /\bmfa\s+failed\b/.test(lower) ||
    /\btwo[-\s]?factor\s+failed\b/.test(lower)
  );
}

export type BetterAuthUserFacingMessageOptions = {
  fallback?: string;
  /** OWASP-aligned sign-in message when the server hints at bad credentials or unknown user. */
  invalidPasswordSignInCopy?: string;
  /** Generic second-factor failure when the server message would vary or leak. */
  invalidOtpCopy?: string;
};

export function getBetterAuthUserFacingMessage(
  error: unknown,
  options?: BetterAuthUserFacingMessageOptions,
): string {
  const fallback = options?.fallback ?? 'Something went wrong. Please try again.';
  const status = readHttpStatus(error);
  const raw = collectRawMessage(error);

  if (!raw) {
    if (status !== undefined && status >= 500) {
      return serverProblemMessage();
    }
    return fallback;
  }

  const lower = raw.toLowerCase();

  if (HTTP_STATUS_ONLY.test(raw)) {
    return serverProblemMessage();
  }

  if (
    lower.includes('server error') ||
    lower.includes('request id:') ||
    lower === 'internal server error' ||
    lower.includes('unexpected error')
  ) {
    return serverProblemMessage(extractSupportReference(raw));
  }

  if (
    lower === 'failed to fetch' ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return 'Network problem. Check your connection and try again.';
  }

  if (lower.includes('too many') || lower.includes('rate limit')) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }

  if (options?.invalidPasswordSignInCopy && isLikelyInvalidPasswordSignInFailure(lower)) {
    return options.invalidPasswordSignInCopy;
  }

  if (options?.invalidOtpCopy && isLikelyInvalidOtpFailure(lower)) {
    return options.invalidOtpCopy;
  }

  return raw;
}
