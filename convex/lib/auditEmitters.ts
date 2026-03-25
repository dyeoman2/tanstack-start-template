import { internal } from '../_generated/api';
import type { ActionCtx, MutationCtx } from '../_generated/server';
import type { AuditProvenanceKind, AuthAuditEventType } from '../../src/lib/shared/auth-audit';

type AuditWriterCtx = Pick<ActionCtx | MutationCtx, 'runMutation'>;

type AuditEventInput = {
  eventType: AuthAuditEventType;
  provenance: {
    kind: AuditProvenanceKind;
    emitter: string;
    actorUserId?: string;
    sessionId?: string;
    identifier?: string;
    initiatedByUserId?: string;
    scimProviderId?: string;
  };
  userId?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  identifier?: string;
  sessionId?: string;
  requestId?: string;
  outcome?: 'success' | 'failure';
  severity?: 'info' | 'warning' | 'critical';
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  sourceSurface: string;
  metadata?: string;
  ipAddress?: string;
  userAgent?: string;
};

async function appendAuditEvent(ctx: AuditWriterCtx, event: AuditEventInput) {
  await ctx.runMutation(internal.audit.appendAuditLedgerEventInternal, event);
}

export async function recordUserAuditEvent(
  ctx: AuditWriterCtx,
  input: Omit<AuditEventInput, 'provenance' | 'actorUserId' | 'sessionId'> & {
    actorUserId: string;
    emitter: string;
    sessionId?: string;
    actorIdentifier?: string;
  },
) {
  await appendAuditEvent(ctx, {
    ...input,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    provenance: {
      kind: 'user',
      emitter: input.emitter,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      identifier: input.actorIdentifier,
    },
  });
}

export async function recordSiteAdminAuditEvent(
  ctx: AuditWriterCtx,
  input: Omit<AuditEventInput, 'provenance' | 'actorUserId' | 'sessionId'> & {
    actorUserId: string;
    emitter: string;
    sessionId?: string;
    actorIdentifier?: string;
  },
) {
  await appendAuditEvent(ctx, {
    ...input,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    provenance: {
      kind: 'site_admin',
      emitter: input.emitter,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      identifier: input.actorIdentifier,
    },
  });
}

export async function recordSystemAuditEvent(
  ctx: AuditWriterCtx,
  input: Omit<AuditEventInput, 'provenance' | 'actorUserId' | 'sessionId'> & {
    emitter: string;
    initiatedByUserId?: string;
    actorUserId?: string;
    actorIdentifier?: string;
    sessionId?: string;
  },
) {
  await appendAuditEvent(ctx, {
    ...input,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    provenance: {
      kind: 'system',
      emitter: input.emitter,
      actorUserId: input.actorUserId,
      sessionId: input.sessionId,
      identifier: input.actorIdentifier,
      initiatedByUserId: input.initiatedByUserId,
    },
  });
}

export async function recordScimAuditEvent(
  ctx: AuditWriterCtx,
  input: Omit<AuditEventInput, 'provenance' | 'actorUserId' | 'sessionId'> & {
    emitter: string;
    scimProviderId: string;
    initiatedByUserId?: string;
    actorIdentifier?: string;
  },
) {
  await appendAuditEvent(ctx, {
    ...input,
    provenance: {
      kind: 'scim_service',
      emitter: input.emitter,
      identifier: input.actorIdentifier,
      initiatedByUserId: input.initiatedByUserId,
      scimProviderId: input.scimProviderId,
    },
  });
}
