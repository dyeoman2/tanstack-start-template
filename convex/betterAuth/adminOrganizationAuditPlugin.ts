import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { getTrustedClientIp, getTrustedUserAgent } from '../../src/lib/shared/better-auth-http';
import type { AuditRecord } from '../lib/authAudit';
import { recordAuthorizationDeniedAuditEvent } from './authorizationDeniedAudit';

type AuditRecorder = (event: AuditRecord) => Promise<void>;

type AdminOrganizationAfterHookContext = GenericEndpointContext & {
  body?: Record<string, unknown>;
  context: GenericEndpointContext['context'] & {
    returned?: unknown;
    session?: {
      user?: {
        id?: string;
      };
    } | null;
  };
};

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getIpAddress(ctx: { headers?: Headers; request?: Request | undefined }) {
  return getTrustedClientIp(ctx);
}

function getUserAgent(ctx: { headers?: Headers; request?: Request | undefined }) {
  return getTrustedUserAgent(ctx);
}

async function readAfterHookErrorDetails(returned: unknown) {
  if (!(returned instanceof Response) || returned.status < 400) {
    return null;
  }

  let errorCode: string | undefined;
  let message: string | undefined;

  try {
    const json = (await returned.clone().json()) as unknown;
    if (typeof json === 'object' && json !== null) {
      if ('code' in json && typeof json.code === 'string') {
        errorCode = json.code;
      }
      if ('message' in json && typeof json.message === 'string') {
        message = json.message;
      }
    }
  } catch {
    // Ignore parse failures and fall back to the defaults below.
  }

  return {
    errorCode,
    message,
    status: returned.status,
  };
}

function isHandledAuthorizationDeniedPath(path: string) {
  return path.startsWith('/admin/') || path.startsWith('/organization/');
}

export function createAdminOrganizationAuditPlugin(
  recordAuditEvent: AuditRecorder,
): BetterAuthPlugin {
  return {
    id: 'adminOrganizationAudit',
    hooks: {
      after: [
        {
          matcher(ctx) {
            return typeof ctx.path === 'string' && isHandledAuthorizationDeniedPath(ctx.path);
          },
          handler: createAuthMiddleware(async (ctx) => {
            const typedCtx = ctx as AdminOrganizationAfterHookContext;
            if (typeof typedCtx.path !== 'string') {
              return;
            }
            const errorDetails = await readAfterHookErrorDetails(typedCtx.context.returned);
            if (!errorDetails) {
              return;
            }

            const identifier =
              normalizeOptionalString(typedCtx.body?.email) ??
              normalizeOptionalString(typedCtx.body?.username);

            try {
              await recordAuthorizationDeniedAuditEvent(recordAuditEvent as never, {
                actorUserId: typedCtx.context.session?.user?.id,
                email: identifier,
                errorCode: errorDetails.errorCode,
                ipAddress: getIpAddress(typedCtx),
                invitationId: normalizeOptionalString(typedCtx.body?.invitationId),
                message: errorDetails.message ?? 'Authorization denied',
                organizationId: normalizeOptionalString(typedCtx.body?.organizationId),
                path: typedCtx.path,
                provider: normalizeOptionalString(typedCtx.body?.provider),
                responseStatus: errorDetails.status,
                userAgent: getUserAgent(typedCtx),
              });
            } catch (error) {
              console.error('Failed to write Better Auth admin/org audit log', error);
            }
          }),
        },
      ],
    },
  };
}
