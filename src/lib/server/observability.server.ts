const SECURITY_LOG_ALLOWLIST: Record<SecurityLogPayload['scope'], readonly string[]> = {
  audit: ['eventType', 'integrityCheckFailures', 'organizationId', 'reportId', 'reviewStatus'],
  health: ['component', 'status', 'timestamp'],
  retention: ['jobKind', 'processedCount', 'status'],
  scan: ['engine', 'fileExtension', 'reason', 'resultStatus'],
  telemetry: [
    'blockedURL',
    'disposition',
    'documentURL',
    'effectiveDirective',
    'eventName',
    'originalPolicy',
    'referrer',
    'status',
    'statusCode',
    'vendor',
    'violatedDirective',
  ],
};

function sanitizeSecurityLogData(
  scope: SecurityLogPayload['scope'],
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const allowedKeys = SECURITY_LOG_ALLOWLIST[scope];
  const entries = Object.entries(value).filter(([key]) => allowedKeys.includes(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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
    data: payload.data ? sanitizeSecurityLogData(payload.scope, payload.data) : undefined,
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
