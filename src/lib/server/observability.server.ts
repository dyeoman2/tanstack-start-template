const SENSITIVE_KEYS = [
  'accessToken',
  'authorization',
  'backupCodes',
  'cookie',
  'cookies',
  'email',
  'error',
  'idToken',
  'message',
  'name',
  'password',
  'phoneNumber',
  'refreshToken',
  'secret',
  'token',
  'userAgent',
];

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    const shouldRedact = SENSITIVE_KEYS.some((candidate) =>
      key.toLowerCase().includes(candidate.toLowerCase()),
    );

    return [key, shouldRedact ? '[REDACTED]' : redactValue(entry)];
  });

  return Object.fromEntries(entries);
}

export type SecurityLogPayload = {
  actorUserId?: string;
  data?: Record<string, unknown>;
  event: string;
  scope: 'audit' | 'health' | 'retention' | 'scan' | 'telemetry';
  status: 'error' | 'info' | 'warning';
};

export function logSecurityEvent(payload: SecurityLogPayload) {
  const body = {
    actorUserId: payload.actorUserId,
    data: payload.data ? redactValue(payload.data) : undefined,
    event: payload.event,
    scope: payload.scope,
    status: payload.status,
    timestamp: new Date().toISOString(),
  };

  const serialized = JSON.stringify(body);
  if (payload.status === 'error') {
    console.error(serialized);
    return;
  }

  if (payload.status === 'warning') {
    console.warn(serialized);
    return;
  }

  console.info(serialized);
}

