export const DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT = Date.parse('2026-03-14T00:00:00.000Z');

export function parseTimestampLike(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

export function resolveEmailVerificationEnforcedAt(configuredValue?: unknown): number {
  return parseTimestampLike(configuredValue) ?? DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT;
}

export function isEmailVerificationRequiredForUser(args: {
  createdAt?: unknown;
  emailVerified?: boolean;
  enforcedAt?: number;
}): boolean {
  if (args.emailVerified === true) {
    return false;
  }

  const createdAt = parseTimestampLike(args.createdAt);
  if (createdAt === null) {
    return false;
  }

  const enforcedAt = args.enforcedAt ?? DEFAULT_EMAIL_VERIFICATION_ENFORCED_AT;
  return createdAt >= enforcedAt;
}
