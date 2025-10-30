export type UserId = string & { readonly __brand: 'UserId' };

type IdentifierRecord = {
  id?: unknown;
  userId?: unknown;
  _id?: unknown;
};

type UserIdentifierSource = string | number | bigint | null | undefined | IdentifierRecord;

const identifierKeys: Array<keyof IdentifierRecord> = ['id', 'userId', '_id'];

function extractUserIdValue(
  source: UserIdentifierSource,
  seen: Set<unknown> = new Set(),
): string | null {
  if (source == null) {
    return null;
  }

  if (typeof source === 'string') {
    const trimmed = source.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof source === 'number' || typeof source === 'bigint') {
    const value = source.toString();
    return value.length > 0 ? value : null;
  }

  if (typeof source !== 'object') {
    return null;
  }

  if (seen.has(source)) {
    return null;
  }

  seen.add(source);

  const record = source as IdentifierRecord;

  for (const key of identifierKeys) {
    if (key in record) {
      const nestedValue = extractUserIdValue(record[key] as UserIdentifierSource, seen);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return null;
}

export function normalizeUserId(source: unknown): UserId | null {
  const value = extractUserIdValue(source as UserIdentifierSource);
  return value ? (value as UserId) : null;
}

export function assertUserId(source: unknown, errorMessage = 'User ID not found'): UserId {
  const userId = normalizeUserId(source);
  if (!userId) {
    throw new Error(errorMessage);
  }
  return userId;
}
