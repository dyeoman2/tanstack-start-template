import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import type { AuditRecord } from '../lib/authAudit';

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

function getHeaderValue(ctx: { headers?: Headers; request?: Request | undefined }, name: string) {
  return ctx.request?.headers.get(name) ?? ctx.headers?.get(name) ?? undefined;
}

function getIpAddress(ctx: { headers?: Headers; request?: Request | undefined }) {
  const forwardedFor = getHeaderValue(ctx, 'x-forwarded-for');
  if (forwardedFor) {
    return normalizeOptionalString(forwardedFor.split(',')[0]);
  }

  return (
    normalizeOptionalString(getHeaderValue(ctx, 'cf-connecting-ip')) ??
    normalizeOptionalString(getHeaderValue(ctx, 'x-real-ip'))
  );
}

function getUserAgent(ctx: { headers?: Headers; request?: Request | undefined }) {
  return normalizeOptionalString(getHeaderValue(ctx, 'user-agent'));
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

function shouldSkipAuthorizationDenied(
  path: string,
  errorDetails: { errorCode?: string; status: number },
) {
  return (
    (path === '/organization/accept-invitation' &&
      errorDetails.status === 403 &&
      errorDetails.errorCode === 'FORBIDDEN') ||
    (path === '/organization/invite-member' &&
      errorDetails.status === 403 &&
      errorDetails.errorCode === 'FORBIDDEN')
  );
}

function getAuthorizationDeniedResourceType(path: string) {
  if (
    path.startsWith('/admin/list-user-sessions') ||
    path.startsWith('/admin/revoke-user-session')
  ) {
    return 'session';
  }

  if (path.startsWith('/organization/')) {
    return 'organization_membership';
  }

  if (path.startsWith('/admin/')) {
    return 'user';
  }

  return 'session';
}

function getAuthorizationDeniedResourceLabel(path: string) {
  switch (path) {
    case '/organization/accept-invitation':
      return 'Invitation acceptance denied';
    case '/organization/invite-member':
      return 'Invitation create denied';
    case '/organization/remove-member':
      return 'Member removal denied';
    case '/organization/update-member-role':
      return 'Member role update denied';
    case '/organization/delete':
      return 'Organization deletion denied';
    case '/organization/update':
      return 'Organization update denied';
    case '/admin/list-user-sessions':
      return 'Admin session inspection denied';
    case '/admin/revoke-user-session':
      return 'Admin session revoke denied';
    case '/admin/revoke-user-sessions':
      return 'Admin revoke all sessions denied';
    default:
      return 'Authorization denied';
  }
}

function getAuthorizationDeniedSourceSurface(path: string) {
  if (path.startsWith('/organization/')) {
    return 'auth.endpoint.organization';
  }

  if (path.startsWith('/admin/')) {
    return 'auth.endpoint.admin_user';
  }

  return 'auth.endpoint.authorization';
}

async function safelyRecord(recordAuditEvent: AuditRecorder, event: AuditRecord) {
  try {
    await recordAuditEvent(event);
  } catch (error) {
    console.error('Failed to write Better Auth admin/org audit log', error);
  }
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
            if (!errorDetails || shouldSkipAuthorizationDenied(typedCtx.path, errorDetails)) {
              return;
            }

            const identifier =
              normalizeOptionalString(typedCtx.body?.email) ??
              normalizeOptionalString(typedCtx.body?.username);

            await safelyRecord(recordAuditEvent, {
              createdAt: Date.now(),
              eventType: 'authorization_denied',
              ...(typedCtx.context.session?.user?.id
                ? { actorUserId: typedCtx.context.session.user.id }
                : {}),
              ...(normalizeOptionalString(typedCtx.body?.organizationId)
                ? { organizationId: normalizeOptionalString(typedCtx.body?.organizationId) }
                : {}),
              ...(identifier ? { identifier } : {}),
              outcome: 'failure',
              severity: 'warning',
              resourceType: getAuthorizationDeniedResourceType(typedCtx.path),
              ...(normalizeOptionalString(typedCtx.body?.invitationId)
                ? { resourceId: normalizeOptionalString(typedCtx.body?.invitationId) }
                : {}),
              resourceLabel: getAuthorizationDeniedResourceLabel(typedCtx.path),
              sourceSurface: getAuthorizationDeniedSourceSurface(typedCtx.path),
              metadata: JSON.stringify({
                attemptedIdentifier: identifier,
                invitationId: normalizeOptionalString(typedCtx.body?.invitationId),
                path: typedCtx.path,
                ...(errorDetails.errorCode ? { responseErrorCode: errorDetails.errorCode } : {}),
                responseErrorMessage: errorDetails.message ?? 'Authorization denied',
                responseStatus: errorDetails.status,
                ...(normalizeOptionalString(typedCtx.body?.provider)
                  ? { provider: normalizeOptionalString(typedCtx.body?.provider) }
                  : {}),
              }),
              ipAddress: getIpAddress(typedCtx),
              userAgent: getUserAgent(typedCtx),
            });
          }),
        },
      ],
    },
  };
}
