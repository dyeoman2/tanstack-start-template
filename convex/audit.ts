import { anyApi, type PaginationResult } from 'convex/server';
import { v } from 'convex/values';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import {
  type AuthAuditEvent,
  isAuthAuditEventType,
  normalizeAuditIdentifier,
} from '../src/lib/shared/auth-audit';
import { assertUserId } from '../src/lib/shared/user-id';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from './_generated/server';
import {
  getVerifiedCurrentAuthUserOrNull,
  getVerifiedCurrentUserFromActionOrThrow,
  requireOrganizationPermissionFromActionOrThrow,
} from './auth/access';
import { throwConvexError } from './auth/errors';
import { buildOrganizationAuditProjection } from './lib/organizationAuditEvents';
import { auditLogsDocValidator, auditLogsResponseValidator } from './lib/returnValidators';

type AuditLogDoc = Doc<'auditLogs'>;
const AUDIT_FETCH_BATCH_SIZE = 128;
const SECURITY_EXPORT_BATCH_SIZE = 100;
const AUDIT_SEVERITY_VALUES = ['info', 'warning', 'critical'] as const;
const AUDIT_OUTCOME_VALUES = ['success', 'failure'] as const;
const CLIENT_AUDIT_EVENT_TYPES = new Set<string>([
  'admin_user_sessions_viewed',
  'pdf_parse_failed',
  'pdf_parse_requested',
  'pdf_parse_succeeded',
]);
const REGULATED_BASELINE_REQUIRED_FIELDS = new Map<
  string,
  Array<
    | 'actorUserId'
    | 'organizationId'
    | 'outcome'
    | 'resourceType'
    | 'resourceId'
    | 'severity'
    | 'sourceSurface'
  >
>([
  [
    'organization_policy_updated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'enterprise_auth_mode_updated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'directory_exported',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'audit_log_exported',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'evidence_report_generated',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_exported',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_reviewed',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'enterprise_scim_token_generated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'enterprise_scim_token_deleted',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'authorization_denied',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'attachment_access_url_issued',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'admin_user_sessions_viewed',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'backup_restore_drill_completed',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'backup_restore_drill_failed',
    ['outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'chat_attachment_quarantined',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'chat_attachment_scan_failed',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
]);

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOutcome(value: string | undefined) {
  return AUDIT_OUTCOME_VALUES.includes(value as (typeof AUDIT_OUTCOME_VALUES)[number])
    ? (value as (typeof AUDIT_OUTCOME_VALUES)[number])
    : undefined;
}

function normalizeSeverity(value: string | undefined) {
  return AUDIT_SEVERITY_VALUES.includes(value as (typeof AUDIT_SEVERITY_VALUES)[number])
    ? (value as (typeof AUDIT_SEVERITY_VALUES)[number])
    : undefined;
}

function parseMetadata(metadata: string | undefined) {
  if (!metadata) {
    return undefined;
  }

  try {
    return JSON.parse(metadata) as unknown;
  } catch {
    return metadata;
  }
}

function requireMetadataObject(eventType: string, metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`Audit event ${eventType} requires structured metadata`);
  }

  return metadata as Record<string, unknown>;
}

function requireMetadataKey(
  eventType: string,
  metadata: Record<string, unknown>,
  key: string,
  kind: 'string' | 'number' | 'object' | 'array',
) {
  const value = metadata[key];
  if (kind === 'string') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Audit event ${eventType} metadata is missing required string key: ${key}`);
    }
    return;
  }
  if (kind === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Audit event ${eventType} metadata is missing required number key: ${key}`);
    }
    return;
  }
  if (kind === 'array') {
    if (!Array.isArray(value)) {
      throw new Error(`Audit event ${eventType} metadata is missing required array key: ${key}`);
    }
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Audit event ${eventType} metadata is missing required object key: ${key}`);
  }
}

function validateEventSpecificMetadata(record: { eventType: string; metadata?: string }) {
  const metadata = parseMetadata(record.metadata);
  switch (record.eventType) {
    case 'audit_log_exported':
    case 'directory_exported': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'exportHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'exportId', 'string');
      requireMetadataKey(record.eventType, parsed, 'manifestHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'rowCount', 'number');
      requireMetadataKey(record.eventType, parsed, 'scope', 'string');
      requireMetadataKey(record.eventType, parsed, 'filters', 'object');
      return;
    }
    case 'evidence_report_generated': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'contentHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'filters', 'object');
      return;
    }
    case 'evidence_report_exported': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'exportHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'exportId', 'string');
      requireMetadataKey(record.eventType, parsed, 'manifestHash', 'string');
      requireMetadataKey(record.eventType, parsed, 'rowCount', 'number');
      requireMetadataKey(record.eventType, parsed, 'scope', 'string');
      requireMetadataKey(record.eventType, parsed, 'filters', 'object');
      return;
    }
    case 'evidence_report_reviewed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'reviewStatus', 'string');
      return;
    }
    case 'enterprise_scim_token_generated':
    case 'enterprise_scim_token_deleted': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'organizationId', 'string');
      requireMetadataKey(record.eventType, parsed, 'providerKey', 'string');
      return;
    }
    case 'authorization_denied': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'permission', 'string');
      requireMetadataKey(record.eventType, parsed, 'reason', 'string');
      return;
    }
    case 'attachment_access_url_issued': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'attachmentId', 'string');
      requireMetadataKey(record.eventType, parsed, 'expiresInMinutes', 'number');
      requireMetadataKey(record.eventType, parsed, 'purpose', 'string');
      return;
    }
    case 'admin_user_sessions_viewed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'targetUserId', 'string');
      requireMetadataKey(record.eventType, parsed, 'sessionCount', 'number');
      return;
    }
    case 'organization_policy_updated': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'changedKeys', 'array');
      return;
    }
    case 'enterprise_auth_mode_updated': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'nextMode', 'string');
      requireMetadataKey(record.eventType, parsed, 'previousMode', 'string');
      return;
    }
    case 'backup_restore_drill_completed':
    case 'backup_restore_drill_failed': {
      const parsed = requireMetadataObject(record.eventType, metadata);
      requireMetadataKey(record.eventType, parsed, 'drillType', 'string');
      requireMetadataKey(record.eventType, parsed, 'verificationMethod', 'string');
      requireMetadataKey(record.eventType, parsed, 'restoredItemCount', 'number');
      return;
    }
    default:
      return;
  }
}

export function validateRegulatedAuditFields(record: {
  actorUserId?: string;
  eventType: string;
  metadata?: string;
  organizationId?: string;
  outcome?: string;
  resourceId?: string;
  resourceType?: string;
  severity?: string;
  sourceSurface?: string;
}) {
  const requiredFields = REGULATED_BASELINE_REQUIRED_FIELDS.get(record.eventType);
  if (!requiredFields) {
    return;
  }

  const missingFields = requiredFields.filter((field) => {
    const value = record[field];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missingFields.length > 0) {
    throw new Error(
      `Audit event ${record.eventType} is missing required baseline fields: ${missingFields.join(', ')}`,
    );
  }

  validateEventSpecificMetadata(record);
}

function toAuditEvent(log: AuditLogDoc): AuthAuditEvent | null {
  if (!isAuthAuditEventType(log.eventType)) {
    return null;
  }

  return {
    id: log.id,
    eventType: log.eventType,
    ...(log.userId ? { userId: log.userId } : {}),
    ...(log.actorUserId ? { actorUserId: log.actorUserId } : {}),
    ...(log.targetUserId ? { targetUserId: log.targetUserId } : {}),
    ...(log.organizationId ? { organizationId: log.organizationId } : {}),
    ...(log.identifier ? { identifier: log.identifier } : {}),
    ...(log.sessionId ? { sessionId: log.sessionId } : {}),
    ...(log.requestId ? { requestId: log.requestId } : {}),
    ...(log.outcome ? { outcome: log.outcome } : {}),
    ...(log.severity ? { severity: log.severity } : {}),
    ...(log.resourceType ? { resourceType: log.resourceType } : {}),
    ...(log.resourceId ? { resourceId: log.resourceId } : {}),
    ...(log.resourceLabel ? { resourceLabel: log.resourceLabel } : {}),
    ...(log.sourceSurface ? { sourceSurface: log.sourceSurface } : {}),
    ...(log.eventHash ? { eventHash: log.eventHash } : {}),
    ...(log.previousEventHash ? { previousEventHash: log.previousEventHash } : {}),
    createdAt: log.createdAt,
    ...(log.ipAddress ? { ipAddress: log.ipAddress } : {}),
    ...(log.userAgent ? { userAgent: log.userAgent } : {}),
    ...(log.metadata ? { metadata: parseMetadata(log.metadata) } : {}),
  };
}

async function hashAuditPayload(payload: string) {
  const encodedPayload = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', encodedPayload);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function buildAuditHashPayload(input: {
  id: string;
  eventType: string;
  createdAt: number;
  userId?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  identifier?: string;
  sessionId?: string;
  requestId?: string;
  outcome?: string;
  severity?: string;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  sourceSurface?: string;
  metadata?: string;
  ipAddress?: string;
  userAgent?: string;
  previousEventHash?: string;
}) {
  return JSON.stringify({
    id: input.id,
    eventType: input.eventType,
    createdAt: input.createdAt,
    userId: input.userId ?? null,
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    organizationId: input.organizationId ?? null,
    identifier: input.identifier ?? null,
    sessionId: input.sessionId ?? null,
    requestId: input.requestId ?? null,
    outcome: input.outcome ?? null,
    severity: input.severity ?? null,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    resourceLabel: input.resourceLabel ?? null,
    sourceSurface: input.sourceSurface ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    previousEventHash: input.previousEventHash ?? null,
  });
}

async function getLatestAuditLog(ctx: QueryCtx | MutationCtx) {
  const latestPage = await ctx.db
    .query('auditLogs')
    .withIndex('by_createdAt')
    .order('desc')
    .take(1);
  return latestPage[0] ?? null;
}

function compareByCreatedAtDesc(left: AuthAuditEvent, right: AuthAuditEvent) {
  const createdAtDiff = right.createdAt - left.createdAt;
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return right.id.localeCompare(left.id);
}

function dedupeEvents(events: AuthAuditEvent[]) {
  const uniqueEvents = new Map<string, AuthAuditEvent>();

  for (const event of events) {
    if (!uniqueEvents.has(event.id)) {
      uniqueEvents.set(event.id, event);
    }
  }

  return Array.from(uniqueEvents.values());
}

async function collectAuditLogsPageForAdmin(
  ctx: QueryCtx,
  filters: {
    eventType?: string;
    identifier?: string;
    organizationId?: string;
    userId?: string;
    cursor: string | null;
  },
) {
  const { eventType, identifier, organizationId, userId, cursor } = filters;

  if (userId) {
    return await ctx.db
      .query('auditLogs')
      .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  if (identifier) {
    return await ctx.db
      .query('auditLogs')
      .withIndex('by_identifier_and_createdAt', (q) => q.eq('identifier', identifier))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  if (eventType) {
    return await ctx.db
      .query('auditLogs')
      .withIndex('by_eventType_and_createdAt', (q) => q.eq('eventType', eventType))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  if (organizationId) {
    return await ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_createdAt', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
  }

  return await ctx.db
    .query('auditLogs')
    .withIndex('by_createdAt')
    .order('desc')
    .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
}

async function collectAuditLogsPageForUser(
  ctx: QueryCtx,
  currentUserId: string,
  cursor: string | null,
) {
  return await ctx.db
    .query('auditLogs')
    .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', currentUserId))
    .order('desc')
    .paginate({ cursor, numItems: AUDIT_FETCH_BATCH_SIZE });
}

export const insertAuditLog = internalMutation({
  args: {
    eventType: v.string(),
    userId: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
    targetUserId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    resourceLabel: v.optional(v.string()),
    sourceSurface: v.optional(v.string()),
    metadata: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isAuthAuditEventType(args.eventType)) {
      throw new Error(`Unsupported audit event type: ${args.eventType}`);
    }

    const id = crypto.randomUUID();
    const createdAt = args.createdAt ?? Date.now();
    const latestLog = await getLatestAuditLog(ctx);
    const previousEventHash = normalizeOptionalString(latestLog?.eventHash);
    const record = {
      id,
      eventType: args.eventType,
      ...(normalizeOptionalString(args.userId)
        ? { userId: normalizeOptionalString(args.userId) }
        : {}),
      ...(normalizeOptionalString(args.actorUserId)
        ? { actorUserId: normalizeOptionalString(args.actorUserId) }
        : {}),
      ...(normalizeOptionalString(args.targetUserId)
        ? { targetUserId: normalizeOptionalString(args.targetUserId) }
        : {}),
      ...(normalizeOptionalString(args.organizationId)
        ? { organizationId: normalizeOptionalString(args.organizationId) }
        : {}),
      ...(normalizeAuditIdentifier(args.identifier)
        ? { identifier: normalizeAuditIdentifier(args.identifier) }
        : {}),
      ...(normalizeOptionalString(args.sessionId)
        ? { sessionId: normalizeOptionalString(args.sessionId) }
        : {}),
      ...(normalizeOptionalString(args.requestId)
        ? { requestId: normalizeOptionalString(args.requestId) }
        : {}),
      ...(normalizeOutcome(args.outcome) ? { outcome: normalizeOutcome(args.outcome) } : {}),
      ...(normalizeSeverity(args.severity) ? { severity: normalizeSeverity(args.severity) } : {}),
      ...(normalizeOptionalString(args.resourceType)
        ? { resourceType: normalizeOptionalString(args.resourceType) }
        : {}),
      ...(normalizeOptionalString(args.resourceId)
        ? { resourceId: normalizeOptionalString(args.resourceId) }
        : {}),
      ...(normalizeOptionalString(args.resourceLabel)
        ? { resourceLabel: normalizeOptionalString(args.resourceLabel) }
        : {}),
      ...(normalizeOptionalString(args.sourceSurface)
        ? { sourceSurface: normalizeOptionalString(args.sourceSurface) }
        : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
      createdAt,
      ...(normalizeOptionalString(args.ipAddress)
        ? { ipAddress: normalizeOptionalString(args.ipAddress) }
        : {}),
      ...(normalizeOptionalString(args.userAgent)
        ? { userAgent: normalizeOptionalString(args.userAgent) }
        : {}),
      ...(previousEventHash ? { previousEventHash } : {}),
    };
    const eventHash = await hashAuditPayload(
      buildAuditHashPayload({
        id,
        eventType: record.eventType,
        createdAt: record.createdAt,
        userId: record.userId,
        actorUserId: record.actorUserId,
        targetUserId: record.targetUserId,
        organizationId: record.organizationId,
        identifier: record.identifier,
        sessionId: record.sessionId,
        requestId: record.requestId,
        outcome: record.outcome,
        severity: record.severity,
        resourceType: record.resourceType,
        resourceId: record.resourceId,
        resourceLabel: record.resourceLabel,
        sourceSurface: record.sourceSurface,
        metadata: record.metadata,
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        previousEventHash,
      }),
    );

    validateRegulatedAuditFields(record);

    await ctx.db.insert('auditLogs', {
      ...record,
      eventHash,
    });

    const organizationProjection = buildOrganizationAuditProjection({
      id,
      eventType: record.eventType,
      userId: record.userId,
      actorUserId: record.actorUserId,
      targetUserId: record.targetUserId,
      organizationId: record.organizationId,
      identifier: record.identifier,
      sessionId: record.sessionId,
      requestId: record.requestId,
      outcome: record.outcome,
      severity: record.severity,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      resourceLabel: record.resourceLabel,
      sourceSurface: record.sourceSurface,
      eventHash,
      previousEventHash,
      metadata: record.metadata,
      createdAt: record.createdAt,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
    });

    if (organizationProjection) {
      await ctx.db.insert('organizationAuditEvents', organizationProjection);
    }

    return null;
  },
});

export const recordClientAuditEvent = internalAction({
  args: {
    eventType: v.string(),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    resourceLabel: v.optional(v.string()),
    sourceSurface: v.optional(v.string()),
    metadata: v.optional(v.any()),
    requestId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    if (!CLIENT_AUDIT_EVENT_TYPES.has(args.eventType)) {
      throwConvexError('VALIDATION', `Unsupported client audit event type: ${args.eventType}`);
    }

    if (args.eventType === 'admin_user_sessions_viewed' && !user.isSiteAdmin) {
      throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
    }

    if (args.organizationId) {
      await requireOrganizationPermissionFromActionOrThrow(ctx, {
        organizationId: args.organizationId,
        permission: 'viewOrganization',
        sourceSurface: args.sourceSurface ?? 'audit.client',
      });
    }

    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: args.eventType,
      userId: user.authUserId,
      actorUserId: user.authUserId,
      organizationId: args.organizationId ?? user.activeOrganizationId ?? undefined,
      identifier:
        args.identifier ??
        (typeof user.authUser.email === 'string'
          ? normalizeAuditIdentifier(user.authUser.email)
          : undefined),
      sessionId: user.authSession?.id ?? undefined,
      requestId: args.requestId,
      outcome: args.outcome,
      severity: args.severity,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      resourceLabel: args.resourceLabel,
      sourceSurface: args.sourceSurface,
      metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
    });
    return null;
  },
});

export const getRecentAuditLogsInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(auditLogsDocValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 500, 2_000));
    return await ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').take(limit);
  },
});

export const getAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    eventType: v.optional(v.string()),
    userId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    sourceSurface: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  returns: auditLogsResponseValidator,
  handler: async (ctx, args) => {
    const authUser = await getVerifiedCurrentAuthUserOrNull(ctx);
    if (!authUser) {
      throwConvexError('UNAUTHENTICATED', 'Not authenticated');
    }

    const currentUserId = assertUserId(authUser, 'Better Auth user missing id');
    const isSiteAdmin = deriveIsSiteAdmin(normalizeUserRole(authUser.role ?? undefined));
    const requestedUserId = normalizeOptionalString(args.userId);
    const requestedIdentifier = normalizeAuditIdentifier(args.identifier);
    const currentIdentifier = normalizeAuditIdentifier(
      typeof authUser.email === 'string' ? authUser.email : undefined,
    );

    if (args.eventType && !isAuthAuditEventType(args.eventType)) {
      throwConvexError('VALIDATION', `Unsupported audit event type: ${args.eventType}`);
    }

    if (!isSiteAdmin && requestedUserId && requestedUserId !== currentUserId) {
      throwConvexError('FORBIDDEN', 'You can only query your own audit logs');
    }

    if (!isSiteAdmin && requestedIdentifier && requestedIdentifier !== currentIdentifier) {
      throwConvexError('FORBIDDEN', 'You can only query your own audit logs');
    }

    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const organizationId = normalizeOptionalString(args.organizationId);
    const filterEvent = (event: AuthAuditEvent) => {
      if (!isSiteAdmin) {
        const matchesUserId = event.userId === currentUserId;
        const matchesIdentifier = currentIdentifier
          ? event.identifier === currentIdentifier
          : false;

        if (!matchesUserId && !matchesIdentifier) {
          return false;
        }
      }

      if (requestedUserId && event.userId !== requestedUserId) {
        return false;
      }

      if (args.eventType && event.eventType !== args.eventType) {
        return false;
      }

      if (organizationId && event.organizationId !== organizationId) {
        return false;
      }

      if (requestedIdentifier && event.identifier !== requestedIdentifier) {
        return false;
      }

      if (args.outcome && event.outcome !== args.outcome) {
        return false;
      }

      if (args.severity && event.severity !== args.severity) {
        return false;
      }

      if (args.sourceSurface && event.sourceSurface !== args.sourceSurface) {
        return false;
      }

      if (args.resourceType && event.resourceType !== args.resourceType) {
        return false;
      }

      return true;
    };

    const events: AuthAuditEvent[] = [];
    let cursor = normalizeOptionalString(args.cursor) ?? null;
    let isDone = false;

    while (events.length < limit && !isDone) {
      const result: PaginationResult<AuditLogDoc> = isSiteAdmin
        ? await collectAuditLogsPageForAdmin(ctx, {
            eventType: args.eventType,
            identifier: requestedIdentifier,
            organizationId,
            userId: requestedUserId,
            cursor,
          })
        : await collectAuditLogsPageForUser(ctx, currentUserId, cursor);

      const nextEvents = dedupeEvents(
        result.page
          .map((log) => toAuditEvent(log))
          .filter((event): event is AuthAuditEvent => event !== null),
      )
        .filter(filterEvent)
        .sort(compareByCreatedAtDesc);

      events.push(...nextEvents);
      isDone = result.isDone;
      cursor = result.isDone ? null : result.continueCursor;
    }

    return {
      events: events.slice(0, limit),
      limit,
      continueCursor: events.length >= limit ? cursor : null,
      isDone: isDone && events.length < limit,
    };
  },
});

export const exportSecurityAuditEventsJsonl = action({
  args: {
    organizationId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    sourceSurface: v.optional(v.string()),
    resourceType: v.optional(v.string()),
  },
  returns: v.object({
    filename: v.string(),
    jsonl: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    if (!user.isSiteAdmin) {
      throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
    }

    const lines: string[] = [];
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const page: {
        events: AuthAuditEvent[];
        continueCursor: string | null;
        isDone: boolean;
        limit: number;
      } = await ctx.runQuery(anyApi.audit.getAuditLogs, {
        limit: SECURITY_EXPORT_BATCH_SIZE,
        cursor: cursor ?? undefined,
        organizationId: args.organizationId,
        outcome: args.outcome,
        severity: args.severity,
        sourceSurface: args.sourceSurface,
        resourceType: args.resourceType,
      });

      for (const event of page.events) {
        lines.push(JSON.stringify(event));
      }

      cursor = page.continueCursor;
      isDone = page.isDone || cursor === null;
    }

    return {
      filename: `security-audit-events-${new Date().toISOString().slice(0, 10)}.jsonl`,
      jsonl: lines.join('\n'),
    };
  },
});

export const verifyAuditIntegrityInternal = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    checkedAt: v.number(),
    checked: v.number(),
    failures: v.array(
      v.object({
        id: v.string(),
      }),
    ),
    ok: v.boolean(),
    failureEventId: v.union(v.string(), v.null()),
    limit: v.number(),
    verified: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    checked: number;
    checkedAt: number;
    failureEventId: string | null;
    failures: Array<{ id: string }>;
    limit: number;
    ok: boolean;
    verified: boolean;
  }> => {
    const limit = Math.max(1, Math.min(args.limit ?? 500, 2_000));
    const checkedAt = Date.now();
    const logs: AuditLogDoc[] = await ctx.runQuery(internal.audit.getRecentAuditLogsInternal, {
      limit,
    });
    const orderedLogs: AuditLogDoc[] = [...logs].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    let previousEventHash: string | undefined;

    for (const log of orderedLogs) {
      const recomputedHash = await hashAuditPayload(
        buildAuditHashPayload({
          id: log.id,
          eventType: log.eventType,
          createdAt: log.createdAt,
          userId: log.userId,
          actorUserId: log.actorUserId,
          targetUserId: log.targetUserId,
          organizationId: log.organizationId,
          identifier: log.identifier,
          sessionId: log.sessionId,
          requestId: log.requestId,
          outcome: log.outcome,
          severity: log.severity,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          resourceLabel: log.resourceLabel,
          sourceSurface: log.sourceSurface,
          metadata: log.metadata,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          previousEventHash,
        }),
      );

      if (log.previousEventHash !== previousEventHash || log.eventHash !== recomputedHash) {
        const failureEventId = crypto.randomUUID();
        await ctx.runMutation(internal.audit.insertAuditLog, {
          eventType: 'audit_integrity_check_failed',
          userId: undefined,
          actorUserId: undefined,
          organizationId: log.organizationId,
          identifier: log.identifier,
          outcome: 'failure',
          severity: 'critical',
          resourceType: 'audit_log',
          resourceId: log.id,
          resourceLabel: log.eventType,
          sourceSurface: 'system.integrity_check',
          metadata: JSON.stringify({
            checkedEventId: log.id,
            checkedEventType: log.eventType,
            expectedPreviousEventHash: previousEventHash ?? null,
            actualPreviousEventHash: log.previousEventHash ?? null,
            actualEventHash: log.eventHash ?? null,
            recomputedEventHash: recomputedHash,
          }),
          requestId: failureEventId,
        });

        return {
          checked: orderedLogs.length,
          checkedAt,
          ok: false,
          failureEventId,
          failures: [{ id: failureEventId }],
          limit,
          verified: false,
        };
      }

      previousEventHash = log.eventHash;
    }

    await ctx.runMutation(internal.securityOps.syncCurrentSecurityFindingsInternal, {
      actorUserId: 'system:audit-integrity',
    });

    return {
      checked: orderedLogs.length,
      checkedAt,
      ok: true,
      failureEventId: null,
      failures: [],
      limit,
      verified: true,
    };
  },
});
