import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import {
  type AuthAuditEventType,
  type AuthAuditHandlerOwner,
  normalizeAuditIdentifier,
} from '../../src/lib/shared/auth-audit';

export type AuditRecord = {
  eventType: AuthAuditEventType;
  userId?: string;
  organizationId?: string;
  identifier?: string;
  metadata?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt?: number;
};

type AuditRecorder = (event: AuditRecord) => Promise<void>;

type SessionUser = {
  email?: string;
  id?: string;
};

type SessionState = {
  activeOrganizationId?: string | null;
  impersonatedBy?: string | null;
};

type AuthSession = {
  session?: SessionState;
  user?: SessionUser;
};

export type AuthAuditEndpointContext = GenericEndpointContext & {
  body?: Record<string, unknown>;
  context: GenericEndpointContext['context'] & {
    newSession?: AuthSession | null;
    returned?: unknown;
    session?: AuthSession | null;
  };
};

type DatabaseHookContext = {
  body?: Record<string, unknown>;
  context?: {
    newSession?: AuthSession | null;
    session?: AuthSession | null;
  };
  headers?: Headers;
  path: string;
  request?: Request;
};

type ResolvedAuthAuditState = {
  actorUserId?: string;
  body: Record<string, unknown>;
  identifierFromSession?: string;
  method?: string;
  organizationId?: string;
  path: string;
  response: Record<string, unknown> | null;
  responseSummary: string;
  sessionSnapshot: AuthSession | null;
  success: boolean;
  targetUserId?: string;
};

type AuthAuditHandler = {
  owner: AuthAuditHandlerOwner;
  kind: 'database_hook' | 'endpoint';
  name: string;
  events: readonly AuthAuditEventType[];
  handle:
    | ((state: ResolvedAuthAuditState, ctx: AuthAuditEndpointContext) => AuditRecord[])
    | ((state: ResolvedAuthAuditState, ctx: AuthAuditEndpointContext) => Promise<AuditRecord[]>);
  paths: readonly string[];
  trigger: string;
};

export type AuthAuditHandlerMeta = Pick<
  AuthAuditHandler,
  'owner' | 'kind' | 'name' | 'events' | 'paths' | 'trigger'
>;

type AuthAuditAfterHookResult = {
  events: AuditRecord[];
  matchedHandlerNames: string[];
  responseSummary: string;
  shouldWarn: boolean;
  success: boolean;
  warningPayload: {
    hasSession: boolean;
    hasUser: boolean;
    method?: string;
    path: string;
    responseSummary: string;
  };
};

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getSessionSnapshot(ctx: AuthAuditEndpointContext) {
  return (ctx.context.newSession ?? ctx.context.session ?? null) as AuthSession | null;
}

function getHeaderValue(ctx: { headers?: Headers; request?: Request }, name: string) {
  return ctx.request?.headers.get(name) ?? ctx.headers?.get(name) ?? undefined;
}

function getRequestMethod(ctx: { request?: Request }) {
  return normalizeOptionalString(ctx.request?.method);
}

function getIpAddress(ctx: { headers?: Headers; request?: Request }) {
  const forwardedFor = getHeaderValue(ctx, 'x-forwarded-for');
  if (forwardedFor) {
    return normalizeOptionalString(forwardedFor.split(',')[0]);
  }

  return (
    normalizeOptionalString(getHeaderValue(ctx, 'cf-connecting-ip')) ??
    normalizeOptionalString(getHeaderValue(ctx, 'x-real-ip'))
  );
}

function getUserAgent(ctx: { headers?: Headers; request?: Request }) {
  return normalizeOptionalString(getHeaderValue(ctx, 'user-agent'));
}

async function readEndpointResponse(
  ctx: AuthAuditEndpointContext,
): Promise<Record<string, unknown> | null> {
  const returned = ctx.context.returned;
  if (!returned) {
    return null;
  }

  if (returned instanceof Response) {
    if (returned.status < 200 || returned.status >= 300) {
      return null;
    }

    try {
      const json = (await returned.clone().json()) as unknown;
      return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  if (returned instanceof Error) {
    return null;
  }

  return typeof returned === 'object' && returned !== null
    ? (returned as Record<string, unknown>)
    : null;
}

function isSuccessfulAuthResponse(ctx: AuthAuditEndpointContext) {
  const returned = ctx.context.returned;
  if (!returned) {
    return false;
  }

  if (returned instanceof Response) {
    return returned.status >= 200 && returned.status < 300;
  }

  return !(returned instanceof Error);
}

function summarizeResponseShape(value: unknown) {
  if (value == null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }

  if (typeof value !== 'object') {
    return typeof value;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  return keys.length > 0 ? `object:${keys.slice(0, 6).join(',')}` : 'object:empty';
}

function maybeStringifyMetadata(value: Record<string, unknown> | undefined) {
  if (!value) {
    return undefined;
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return JSON.stringify(Object.fromEntries(entries));
}

function buildEventMetadata(
  state: { method?: string; path: string },
  userId: string | undefined,
  actorUserId: string | undefined,
  extra?: Record<string, unknown>,
) {
  const metadata: Record<string, unknown> = {
    path: state.path,
    ...(state.method ? { method: state.method } : {}),
    ...(extra ?? {}),
  };

  if (actorUserId && actorUserId !== userId) {
    metadata.actorUserId = actorUserId;
  }

  return maybeStringifyMetadata(metadata);
}

function createAuditRecord(
  ctx: { headers?: Headers; request?: Request },
  state: { method?: string; path: string },
  input: {
    eventType: AuthAuditEventType;
    userId?: string;
    organizationId?: string;
    identifier?: string;
    metadata?: Record<string, unknown>;
  },
  actorUserId?: string,
): AuditRecord {
  return {
    eventType: input.eventType,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(normalizeAuditIdentifier(input.identifier)
      ? { identifier: normalizeAuditIdentifier(input.identifier) }
      : {}),
    metadata: buildEventMetadata(state, input.userId, actorUserId, input.metadata),
    ipAddress: getIpAddress(ctx),
    userAgent: getUserAgent(ctx),
  };
}

function isSignupPath(path: string) {
  return (
    path.startsWith('/sign-up/') ||
    path.startsWith('/callback/') ||
    path.startsWith('/oauth2/callback')
  );
}

function isSigninPath(path: string) {
  return path.startsWith('/sign-in/') || isSignupPath(path);
}

function resolveAuthAuditState(
  ctx: AuthAuditEndpointContext,
  response: Record<string, unknown> | null,
): ResolvedAuthAuditState {
  const sessionSnapshot = getSessionSnapshot(ctx);
  const actorUserId = normalizeOptionalString(ctx.context.session?.user?.id);
  const targetUserId =
    normalizeOptionalString(response?.userId) ??
    normalizeOptionalString((response?.user as Record<string, unknown> | undefined)?.id) ??
    normalizeOptionalString(sessionSnapshot?.user?.id);

  return {
    actorUserId,
    body: ctx.body ?? {},
    identifierFromSession: normalizeAuditIdentifier(
      normalizeOptionalString(sessionSnapshot?.user?.email),
    ),
    method: getRequestMethod(ctx),
    organizationId:
      normalizeOptionalString(response?.organizationId) ??
      normalizeOptionalString(ctx.body?.organizationId) ??
      normalizeOptionalString(sessionSnapshot?.session?.activeOrganizationId),
    path: ctx.path,
    response,
    responseSummary: summarizeResponseShape(response ?? ctx.context.returned),
    sessionSnapshot,
    success: isSuccessfulAuthResponse(ctx),
    targetUserId,
  };
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

const endpointAuditHandlers: readonly AuthAuditHandler[] = [
  {
    owner: 'session',
    kind: 'endpoint',
    name: 'session.sign-out',
    trigger: 'after:/sign-out',
    paths: ['/sign-out'],
    events: ['user_signed_out'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'user_signed_out',
          userId: state.actorUserId,
          organizationId: state.organizationId,
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'verification',
    kind: 'endpoint',
    name: 'verification.password-reset-requested',
    trigger: 'after:/request-password-reset|/forget-password/email-otp',
    paths: ['/request-password-reset', '/forget-password/email-otp'],
    events: ['password_reset_requested'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'password_reset_requested',
          identifier: normalizeOptionalString(state.body.email),
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'verification',
    kind: 'endpoint',
    name: 'verification.password-reset-completed',
    trigger: 'after:/reset-password',
    paths: ['/reset-password'],
    events: ['password_reset_completed'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'password_reset_completed',
          userId: state.targetUserId,
          organizationId: state.organizationId,
          identifier:
            normalizeOptionalString(asRecord(state.response?.user)?.email) ??
            normalizeOptionalString(state.body.email),
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'verification',
    kind: 'endpoint',
    name: 'verification.email-sent',
    trigger: 'after:/send-verification-email',
    paths: ['/send-verification-email'],
    events: ['email_verification_sent'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'email_verification_sent',
          userId: state.actorUserId,
          organizationId: state.organizationId,
          identifier: state.identifierFromSession ?? normalizeOptionalString(state.body.email),
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'verification',
    kind: 'endpoint',
    name: 'verification.email-verified',
    trigger: 'after:/verify-email',
    paths: ['/verify-email'],
    events: ['user_email_verified'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'user_email_verified',
          userId: state.targetUserId,
          organizationId: state.organizationId,
          identifier:
            normalizeOptionalString(asRecord(state.response?.user)?.email) ??
            state.identifierFromSession,
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'user',
    kind: 'endpoint',
    name: 'user.update-profile',
    trigger: 'after:/update-user',
    paths: ['/update-user'],
    events: ['user_profile_updated', 'user_profile_image_updated'],
    handle: (state, ctx) => {
      const events: AuditRecord[] = [];
      const image = normalizeOptionalString(state.body.image);
      const userId = state.actorUserId;

      if (normalizeOptionalString(state.body.name) || normalizeOptionalString(state.body.email)) {
        events.push(
          createAuditRecord(
            ctx,
            state,
            {
              eventType: 'user_profile_updated',
              userId,
              organizationId: state.organizationId,
              metadata: {
                email: normalizeOptionalString(state.body.email),
                name: normalizeOptionalString(state.body.name),
              },
            },
            state.actorUserId,
          ),
        );
      }

      if (image) {
        events.push(
          createAuditRecord(
            ctx,
            state,
            {
              eventType: 'user_profile_image_updated',
              userId,
              organizationId: state.organizationId,
              metadata: { image },
            },
            state.actorUserId,
          ),
        );
      }

      return events;
    },
  },
  {
    owner: 'account',
    kind: 'endpoint',
    name: 'account.password-changed',
    trigger: 'after:/change-password|/admin/set-user-password',
    paths: ['/change-password', '/admin/set-user-password'],
    events: ['password_changed'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId) ?? state.actorUserId;
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'password_changed',
            userId: targetUserId,
            organizationId: state.organizationId,
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'user',
    kind: 'endpoint',
    name: 'user.deleted',
    trigger: 'after:/delete-user|/admin/remove-user',
    paths: ['/delete-user', '/admin/remove-user'],
    events: ['user_deleted'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId) ?? state.actorUserId;
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'user_deleted',
            userId: targetUserId,
            organizationId: state.organizationId,
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'session',
    kind: 'endpoint',
    name: 'session.revoked',
    trigger: 'after:/revoke-session|/admin/revoke-user-session',
    paths: ['/revoke-session', '/admin/revoke-user-session'],
    events: ['session_revoked'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId) ?? state.actorUserId;
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'session_revoked',
            userId: targetUserId,
            organizationId: state.organizationId,
            metadata: {
              sessionId: normalizeOptionalString(state.body.sessionId),
              sessionToken: normalizeOptionalString(state.body.sessionToken),
            },
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'session',
    kind: 'endpoint',
    name: 'session.revoked-all',
    trigger: 'after:/revoke-sessions|/admin/revoke-user-sessions',
    paths: ['/revoke-sessions', '/admin/revoke-user-sessions'],
    events: ['sessions_revoked_all'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId) ?? state.actorUserId;
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'sessions_revoked_all',
            userId: targetUserId,
            organizationId: state.organizationId,
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'account',
    kind: 'endpoint',
    name: 'account.linked',
    trigger: 'after:/link-social',
    paths: ['/link-social'],
    events: ['account_linked'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'account_linked',
          userId: state.actorUserId,
          organizationId: state.organizationId,
          metadata: {
            provider: normalizeOptionalString(state.body.provider),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'account',
    kind: 'endpoint',
    name: 'account.unlinked',
    trigger: 'after:/unlink-account',
    paths: ['/unlink-account'],
    events: ['account_unlinked'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'account_unlinked',
          userId: state.actorUserId,
          organizationId: state.organizationId,
          metadata: {
            accountId: normalizeOptionalString(state.body.accountId),
            providerId: normalizeOptionalString(state.body.providerId),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'user',
    kind: 'endpoint',
    name: 'user.banned',
    trigger: 'after:/admin/ban-user',
    paths: ['/admin/ban-user'],
    events: ['user_banned'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId);
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'user_banned',
            userId: targetUserId,
            metadata: {
              banReason: normalizeOptionalString(state.body.banReason),
            },
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'user',
    kind: 'endpoint',
    name: 'user.unbanned',
    trigger: 'after:/admin/unban-user',
    paths: ['/admin/unban-user'],
    events: ['user_unbanned'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId);
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'user_unbanned',
            userId: targetUserId,
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'session',
    kind: 'endpoint',
    name: 'session.impersonated',
    trigger: 'after:/admin/impersonate-user',
    paths: ['/admin/impersonate-user'],
    events: ['user_impersonated'],
    handle: (state, ctx) => {
      const targetUserId = normalizeOptionalString(state.body.userId);
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'user_impersonated',
            userId: targetUserId,
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'session',
    kind: 'endpoint',
    name: 'session.impersonation-stopped',
    trigger: 'after:/admin/stop-impersonating',
    paths: ['/admin/stop-impersonating'],
    events: ['user_impersonation_stopped'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'user_impersonation_stopped',
          userId: state.actorUserId,
        },
        normalizeOptionalString(state.sessionSnapshot?.session?.impersonatedBy),
      ),
    ],
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.created',
    trigger: 'after:/organization/create',
    paths: ['/organization/create'],
    events: ['organization_created'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'organization_created',
          userId: state.actorUserId,
          organizationId:
            normalizeOptionalString(state.response?.id) ??
            normalizeOptionalString(asRecord(state.response?.organization)?.id),
          metadata: {
            name:
              normalizeOptionalString(state.response?.name) ??
              normalizeOptionalString(state.body.name),
            slug:
              normalizeOptionalString(state.response?.slug) ??
              normalizeOptionalString(state.body.slug),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.updated',
    trigger: 'after:/organization/update',
    paths: ['/organization/update'],
    events: ['organization_updated'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'organization_updated',
          userId: state.actorUserId,
          organizationId: state.organizationId,
          metadata: {
            name: normalizeOptionalString(state.body.name),
            slug: normalizeOptionalString(state.body.slug),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.member-invited',
    trigger: 'after:/organization/invite-member',
    paths: ['/organization/invite-member'],
    events: ['member_invited'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'member_invited',
          userId: state.actorUserId,
          organizationId: state.organizationId,
          identifier: normalizeOptionalString(state.body.email),
          metadata: {
            invitationId:
              normalizeOptionalString(state.response?.id) ??
              normalizeOptionalString(asRecord(state.response?.invitation)?.id) ??
              normalizeOptionalString(state.body.invitationId),
            role: normalizeOptionalString(state.body.role),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.invitation-accepted',
    trigger: 'after:/organization/accept-invitation',
    paths: ['/organization/accept-invitation'],
    events: ['invite_accepted', 'member_added'],
    handle: (state, ctx) => {
      const invitation = asRecord(state.response?.invitation);
      const inviteIdentifier =
        normalizeOptionalString(invitation?.email) ?? state.identifierFromSession;
      const invitationId =
        normalizeOptionalString(invitation?.id) ??
        normalizeOptionalString(state.response?.id) ??
        normalizeOptionalString(state.body.invitationId);

      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'invite_accepted',
            userId: state.targetUserId,
            organizationId: state.organizationId,
            identifier: inviteIdentifier,
            metadata: {
              invitationId,
            },
          },
          state.actorUserId,
        ),
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'member_added',
            userId: state.targetUserId,
            organizationId: state.organizationId,
            identifier: inviteIdentifier,
            metadata: {
              invitationId,
            },
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.invitation-rejected',
    trigger: 'after:/organization/reject-invitation',
    paths: ['/organization/reject-invitation'],
    events: ['invite_rejected'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'invite_rejected',
          userId: state.targetUserId,
          organizationId: state.organizationId,
          metadata: {
            invitationId:
              normalizeOptionalString(asRecord(state.response?.invitation)?.id) ??
              normalizeOptionalString(state.response?.id) ??
              normalizeOptionalString(state.body.invitationId),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.invitation-cancelled',
    trigger: 'after:/organization/cancel-invitation',
    paths: ['/organization/cancel-invitation'],
    events: ['invite_cancelled'],
    handle: (state, ctx) => [
      createAuditRecord(
        ctx,
        state,
        {
          eventType: 'invite_cancelled',
          userId: state.actorUserId,
          organizationId: state.organizationId,
          identifier: normalizeOptionalString(state.body.email),
          metadata: {
            invitationId: normalizeOptionalString(state.body.invitationId),
          },
        },
        state.actorUserId,
      ),
    ],
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.member-removed',
    trigger: 'after:/organization/remove-member|/organization/leave',
    paths: ['/organization/remove-member', '/organization/leave'],
    events: ['member_removed'],
    handle: (state, ctx) => {
      const targetUserId =
        normalizeOptionalString(state.body.memberId) ??
        normalizeOptionalString(state.body.userId) ??
        state.actorUserId;
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'member_removed',
            userId: targetUserId,
            organizationId: state.organizationId,
          },
          state.actorUserId,
        ),
      ];
    },
  },
  {
    owner: 'organization',
    kind: 'endpoint',
    name: 'organization.member-role-updated',
    trigger: 'after:/organization/update-member-role',
    paths: ['/organization/update-member-role'],
    events: ['member_role_updated'],
    handle: (state, ctx) => {
      const targetUserId =
        normalizeOptionalString(state.body.memberId) ?? normalizeOptionalString(state.body.userId);
      return [
        createAuditRecord(
          ctx,
          state,
          {
            eventType: 'member_role_updated',
            userId: targetUserId,
            organizationId: state.organizationId,
            metadata: {
              role: normalizeOptionalString(state.body.role),
            },
          },
          state.actorUserId,
        ),
      ];
    },
  },
] as const;

export const AUTH_AUDIT_HANDLER_REGISTRY = endpointAuditHandlers.map((handler) => ({
  owner: handler.owner,
  kind: handler.kind,
  name: handler.name,
  events: handler.events,
  paths: handler.paths,
  trigger: handler.trigger,
})) satisfies readonly AuthAuditHandlerMeta[];

const hookHandlerRegistry = [
  {
    owner: 'user',
    kind: 'database_hook',
    name: 'user.create.after',
    trigger: 'database:user.create.after',
    paths: ['/sign-up/*', '/callback/*', '/oauth2/callback'],
    events: ['user_signed_up'],
  },
  {
    owner: 'session',
    kind: 'database_hook',
    name: 'session.create.after',
    trigger: 'database:session.create.after',
    paths: ['/sign-in/*', '/sign-up/*', '/callback/*', '/oauth2/callback'],
    events: ['session_created', 'user_signed_in'],
  },
] as const satisfies readonly AuthAuditHandlerMeta[];

export const AUTH_AUDIT_ALL_HANDLER_REGISTRY = [
  ...hookHandlerRegistry,
  ...AUTH_AUDIT_HANDLER_REGISTRY,
] as const;

function getHookOrganizationId(ctx: DatabaseHookContext) {
  const sessionSnapshot = (ctx.context?.newSession ??
    ctx.context?.session ??
    null) as AuthSession | null;
  return (
    normalizeOptionalString(sessionSnapshot?.session?.activeOrganizationId) ??
    normalizeOptionalString(ctx.body?.organizationId)
  );
}

async function safelyRecord(recordAuditEvent: AuditRecorder, event: AuditRecord) {
  try {
    await recordAuditEvent(event);
  } catch (error) {
    console.error('Failed to write auth audit log', error);
  }
}

export async function buildUserCreateAuditRecordsForTesting(
  user: { email?: string; id?: string },
  ctx: DatabaseHookContext | undefined,
) {
  if (!ctx || !isSignupPath(ctx.path)) {
    return [] satisfies AuditRecord[];
  }

  const userId = normalizeOptionalString(user.id);
  return [
    createAuditRecord(
      ctx,
      { method: getRequestMethod(ctx), path: ctx.path },
      {
        eventType: 'user_signed_up',
        userId,
        organizationId: getHookOrganizationId(ctx),
        identifier: normalizeOptionalString(user.email),
      },
      userId,
    ),
  ];
}

export async function buildSessionCreateAuditRecordsForTesting(
  session: {
    id?: string;
    ipAddress?: string;
    userAgent?: string;
    userId?: string;
  },
  ctx:
    | (DatabaseHookContext & {
        context: {
          internalAdapter: {
            findUserById: (userId: string) => Promise<SessionUser | null>;
          };
        };
      })
    | null,
) {
  if (!ctx) {
    return [] satisfies AuditRecord[];
  }

  const userId = normalizeOptionalString(session.userId);
  const authUser = userId ? await ctx.context.internalAdapter.findUserById(userId) : null;
  const baseState = {
    method: getRequestMethod(ctx),
    path: ctx.path,
  };
  const events = [
    createAuditRecord(
      {
        headers: ctx.headers,
        request: ctx.request,
      },
      baseState,
      {
        eventType: 'session_created',
        userId,
        organizationId: getHookOrganizationId(ctx),
        identifier: normalizeOptionalString(authUser?.email),
        metadata: {
          sessionId: normalizeOptionalString(session.id),
        },
      },
      userId,
    ),
  ];

  if (isSigninPath(ctx.path)) {
    events.push(
      createAuditRecord(
        {
          headers: ctx.headers,
          request: ctx.request,
        },
        baseState,
        {
          eventType: 'user_signed_in',
          userId,
          organizationId: getHookOrganizationId(ctx),
          identifier: normalizeOptionalString(authUser?.email),
          metadata: {
            sessionId: normalizeOptionalString(session.id),
          },
        },
        userId,
      ),
    );
  }

  return events.map((event) => ({
    ...event,
    ipAddress: normalizeOptionalString(session.ipAddress) ?? event.ipAddress,
    userAgent: normalizeOptionalString(session.userAgent) ?? event.userAgent,
  }));
}

export async function processAuthAuditAfterHookForTesting(
  ctx: AuthAuditEndpointContext,
): Promise<AuthAuditAfterHookResult> {
  const response = await readEndpointResponse(ctx);
  const state = resolveAuthAuditState(ctx, response);
  const matchedHandlers = endpointAuditHandlers.filter((handler) =>
    handler.paths.includes(state.path),
  );
  const handlerResults = await Promise.all(
    matchedHandlers.map((handler) => handler.handle(state, ctx)),
  );
  const events: AuditRecord[] = [];
  for (const handlerEvents of handlerResults) {
    events.push(...handlerEvents);
  }

  return {
    events,
    matchedHandlerNames: matchedHandlers.map((handler) => handler.name),
    responseSummary: state.responseSummary,
    shouldWarn: state.success && events.length === 0,
    success: state.success,
    warningPayload: {
      hasSession: state.sessionSnapshot !== null,
      hasUser: state.targetUserId !== undefined || state.actorUserId !== undefined,
      ...(state.method ? { method: state.method } : {}),
      path: state.path,
      responseSummary: state.responseSummary,
    },
  };
}

const warnedUnmappedAuditEndpoints = new Set<string>();

export function resetUnmappedAuditWarningsForTesting() {
  warnedUnmappedAuditEndpoints.clear();
}

export function maybeWarnOnUnmappedAuditEndpointForTesting(result: AuthAuditAfterHookResult) {
  if (process.env.NODE_ENV !== 'development' || !result.shouldWarn) {
    return false;
  }

  const warningKey = `${result.warningPayload.method ?? 'UNKNOWN'}:${result.warningPayload.path}`;
  if (warnedUnmappedAuditEndpoints.has(warningKey)) {
    return false;
  }

  warnedUnmappedAuditEndpoints.add(warningKey);
  console.warn('Unmapped Better Auth audit endpoint', result.warningPayload);
  return true;
}

export function createAuthAuditPlugin(recordAuditEvent: AuditRecorder): BetterAuthPlugin {
  return {
    id: 'authAudit',
    init() {
      return {
        options: {
          databaseHooks: {
            user: {
              create: {
                async after(user, ctx) {
                  const events = await buildUserCreateAuditRecordsForTesting(
                    user as { email?: string; id?: string },
                    ctx as DatabaseHookContext | undefined,
                  );

                  for (const event of events) {
                    await safelyRecord(recordAuditEvent, {
                      ...event,
                      createdAt: Date.now(),
                    });
                  }
                },
              },
            },
            session: {
              create: {
                async after(session, ctx) {
                  const events = await buildSessionCreateAuditRecordsForTesting(
                    session as {
                      id?: string;
                      ipAddress?: string;
                      userAgent?: string;
                      userId?: string;
                    },
                    ctx as
                      | (DatabaseHookContext & {
                          context: {
                            internalAdapter: {
                              findUserById: (userId: string) => Promise<SessionUser | null>;
                            };
                          };
                        })
                      | null,
                  );

                  for (const event of events) {
                    await safelyRecord(recordAuditEvent, {
                      ...event,
                      createdAt: Date.now(),
                    });
                  }
                },
              },
            },
          },
        },
      };
    },
    hooks: {
      after: [
        {
          matcher() {
            return true;
          },
          handler: createAuthMiddleware(async (rawCtx) => {
            const result = await processAuthAuditAfterHookForTesting(
              rawCtx as AuthAuditEndpointContext,
            );

            for (const event of result.events) {
              await safelyRecord(recordAuditEvent, {
                ...event,
                createdAt: Date.now(),
              });
            }

            maybeWarnOnUnmappedAuditEndpointForTesting(result);
          }),
        },
      ],
    },
  };
}
