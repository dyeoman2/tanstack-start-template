type TelemetryPrimitive = boolean | number | string | null;
type TelemetryValue = TelemetryPrimitive | Record<string, TelemetryPrimitive>;

const SAFE_TOP_LEVEL_KEYS = new Set([
  'contexts',
  'environment',
  'event_id',
  'exception',
  'fingerprint',
  'level',
  'logger',
  'message',
  'platform',
  'release',
  'tags',
  'timestamp',
  'transaction',
  'type',
]);

const SAFE_TAG_KEYS = new Set(['component', 'feature', 'route', 'surface', 'vendor']);
const SAFE_CONTEXT_KEYS = new Set(['app', 'browser', 'device', 'os', 'runtime', 'trace']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePrimitive(value: unknown): TelemetryPrimitive {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  return '[REDACTED]';
}

function sanitizeTags(value: unknown): Record<string, TelemetryPrimitive> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([key]) => SAFE_TAG_KEYS.has(key))
    .map(([key, entry]) => [key, sanitizePrimitive(entry)]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeContexts(value: unknown): Record<string, TelemetryValue> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([key]) => SAFE_CONTEXT_KEYS.has(key))
    .map(([key, entry]) => [key, sanitizePrimitive(entry)]);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function sanitizeTelemetryEvent<T extends object>(event: T): T {
  const sanitizedEntries = Object.entries(event as Record<string, unknown>).flatMap(
    ([key, value]) => {
      if (!SAFE_TOP_LEVEL_KEYS.has(key)) {
        return [];
      }

      if (key === 'tags') {
        const tags = sanitizeTags(value);
        return tags ? [[key, tags]] : [];
      }

      if (key === 'contexts') {
        const contexts = sanitizeContexts(value);
        return contexts ? [[key, contexts]] : [];
      }

      if (key === 'exception') {
        return [[key, value]];
      }

      return [[key, sanitizePrimitive(value)]];
    },
  );

  return Object.fromEntries(sanitizedEntries) as T;
}
