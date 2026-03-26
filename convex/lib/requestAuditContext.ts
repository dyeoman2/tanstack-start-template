import { v } from 'convex/values';

export const requestAuditContextValidator = v.object({
  requestId: v.string(),
  ipAddress: v.union(v.string(), v.null()),
  userAgent: v.union(v.string(), v.null()),
});

type RequestAuditContextInput = {
  ipAddress?: string | null;
  requestId?: string | null;
  userAgent?: string | null;
};

type SessionAuditContextInput = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveAuditRequestContext(input: {
  requestContext?: RequestAuditContextInput | null;
  session?: SessionAuditContextInput | null;
}) {
  const requestContext = input.requestContext ?? null;
  const session = input.session ?? null;

  return {
    ...(normalizeOptionalString(requestContext?.requestId)
      ? { requestId: normalizeOptionalString(requestContext?.requestId) }
      : {}),
    ...((normalizeOptionalString(requestContext?.ipAddress) ??
    normalizeOptionalString(session?.ipAddress))
      ? {
          ipAddress:
            normalizeOptionalString(requestContext?.ipAddress) ??
            normalizeOptionalString(session?.ipAddress),
        }
      : {}),
    ...((normalizeOptionalString(requestContext?.userAgent) ??
    normalizeOptionalString(session?.userAgent))
      ? {
          userAgent:
            normalizeOptionalString(requestContext?.userAgent) ??
            normalizeOptionalString(session?.userAgent),
        }
      : {}),
  };
}
