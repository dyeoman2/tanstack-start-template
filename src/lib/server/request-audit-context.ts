import { getTrustedClientIp, getTrustedUserAgent } from '~/lib/server/better-auth/http';
import type { RequestAuditContext } from '~/lib/shared/request-audit-context';

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getHeaderValue(request: Request, name: string) {
  return normalizeOptionalString(request.headers.get(name));
}

export function resolveRequestAuditContext(request: Request): RequestAuditContext {
  return {
    requestId: getHeaderValue(request, 'x-request-id') ?? globalThis.crypto.randomUUID(),
    ipAddress: getTrustedClientIp(request) ?? null,
    userAgent: getTrustedUserAgent(request) ?? null,
  };
}
