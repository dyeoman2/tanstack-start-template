import { createFileRoute } from '@tanstack/react-router';
import { logSecurityEvent } from '~/lib/server/observability.server';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

async function parseRequestBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  const normalizedContentType = contentType.toLowerCase();
  if (!normalizedContentType.includes('json') && !normalizedContentType.includes('csp-report')) {
    return null;
  }

  try {
    return await request.json();
  } catch {
    return null;
  }
}

function extractReportBody(payload: unknown): Record<string, unknown> | null {
  const topLevel = asRecord(payload);
  if (!topLevel) {
    return null;
  }

  return (
    asRecord(topLevel['csp-report']) ??
    asRecord(topLevel.body) ??
    asRecord(topLevel['body']) ??
    topLevel
  );
}

export const Route = createFileRoute('/api/csp-report')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = await parseRequestBody(request);
        const body = extractReportBody(payload);

        if (body) {
          const effectiveDirective = readString(body, 'effectiveDirective', 'effective-directive');
          const violatedDirective = readString(body, 'violatedDirective', 'violated-directive');

          // Track style-src-attr violations separately for residual-risk monitoring.
          // This directive is an accepted risk (Tailwind/Radix inline style attributes),
          // but unexpected violations could indicate a CSS injection attempt.
          const isStyleSrcAttrViolation =
            effectiveDirective === 'style-src-attr' ||
            violatedDirective?.startsWith('style-src-attr');

          logSecurityEvent({
            data: {
              blockedURL: readString(body, 'blockedURL', 'blocked-uri'),
              disposition: readString(body, 'disposition'),
              documentURL: readString(body, 'documentURL', 'document-uri'),
              effectiveDirective,
              isStyleSrcAttrViolation,
              originalPolicy: readString(body, 'originalPolicy', 'original-policy'),
              referrer: readString(body, 'referrer'),
              statusCode: readNumber(body, 'statusCode', 'status-code'),
              violatedDirective,
            },
            event: 'csp_violation',
            scope: 'telemetry',
            status: isStyleSrcAttrViolation ? 'info' : 'warning',
          });
        }

        return new Response(null, {
          status: 204,
          headers: {
            'Cache-Control': 'no-store',
          },
        });
      },
    },
  },
});
