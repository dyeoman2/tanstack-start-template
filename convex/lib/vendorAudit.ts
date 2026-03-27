import type { ActionCtx, MutationCtx } from '../_generated/server';
import {
  buildVendorAuditMetadata,
  getVendorBoundaryPolicy,
  resolveVendorBoundaryDecision,
  type VendorAuditContext,
  type VendorBoundaryDecision,
  type VendorDataClass,
  type VendorKey,
  VendorBoundaryError,
} from '../../src/lib/server/vendor-boundary.server';
import {
  recordSiteAdminAuditEvent,
  recordSystemAuditEvent,
  recordUserAuditEvent,
} from './auditEmitters';

type AuditWriterCtx = Pick<ActionCtx | MutationCtx, 'runMutation'>;

type BaseVendorAuditTarget = {
  emitter: string;
  organizationId?: string;
  requestId?: string;
  sourceSurface: string;
};

export type VendorAuditTarget =
  | (BaseVendorAuditTarget & {
      actorIdentifier?: string;
      actorUserId: string;
      kind: 'site_admin';
      sessionId?: string;
      userId?: string;
    })
  | (BaseVendorAuditTarget & {
      actorIdentifier?: string;
      actorUserId?: string;
      initiatedByUserId?: string;
      kind: 'system';
      sessionId?: string;
      userId?: string;
    })
  | (BaseVendorAuditTarget & {
      actorIdentifier?: string;
      actorUserId: string;
      kind: 'user';
      sessionId?: string;
      userId?: string;
    });

type VendorAccessUsedAudit = {
  context?: VendorAuditContext;
  outcome?: 'failure' | 'success';
  severity?: 'critical' | 'info' | 'warning';
};

function mergeVendorAuditContext(
  base: VendorAuditContext | undefined,
  override: VendorAuditContext | undefined,
): VendorAuditContext | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...base,
    ...override,
  };
}

async function recordVendorAuditEvent(
  ctx: AuditWriterCtx,
  target: VendorAuditTarget,
  args: {
    context?: VendorAuditContext;
    dataClasses: readonly VendorDataClass[];
    eventType: 'outbound_vendor_access_denied' | 'outbound_vendor_access_used';
    operation: string;
    outcome: 'failure' | 'success';
    severity: 'critical' | 'info' | 'warning';
    vendor: VendorKey;
  },
) {
  const displayName = getVendorBoundaryPolicy(args.vendor).displayName;
  const metadata = buildVendorAuditMetadata({
    decision: {
      vendor: args.vendor,
      dataClasses: args.dataClasses,
    },
    operation: args.operation,
    sourceSurface: target.sourceSurface,
    context: args.context,
  });

  if (target.kind === 'user') {
    await recordUserAuditEvent(ctx, {
      actorIdentifier: target.actorIdentifier,
      actorUserId: target.actorUserId,
      emitter: target.emitter,
      eventType: args.eventType,
      metadata,
      organizationId: target.organizationId,
      outcome: args.outcome,
      requestId: target.requestId,
      resourceId: args.vendor,
      resourceLabel: displayName,
      resourceType: 'vendor',
      sessionId: target.sessionId,
      severity: args.severity,
      sourceSurface: target.sourceSurface,
      userId: target.userId ?? target.actorUserId,
    });
    return;
  }

  if (target.kind === 'site_admin') {
    await recordSiteAdminAuditEvent(ctx, {
      actorIdentifier: target.actorIdentifier,
      actorUserId: target.actorUserId,
      emitter: target.emitter,
      eventType: args.eventType,
      metadata,
      organizationId: target.organizationId,
      outcome: args.outcome,
      requestId: target.requestId,
      resourceId: args.vendor,
      resourceLabel: displayName,
      resourceType: 'vendor',
      sessionId: target.sessionId,
      severity: args.severity,
      sourceSurface: target.sourceSurface,
      userId: target.userId ?? target.actorUserId,
    });
    return;
  }

  await recordSystemAuditEvent(ctx, {
    actorIdentifier: target.actorIdentifier,
    actorUserId: target.actorUserId,
    emitter: target.emitter,
    eventType: args.eventType,
    initiatedByUserId: target.initiatedByUserId,
    metadata,
    organizationId: target.organizationId,
    outcome: args.outcome,
    requestId: target.requestId,
    resourceId: args.vendor,
    resourceLabel: displayName,
    resourceType: 'vendor',
    sessionId: target.sessionId,
    severity: args.severity,
    sourceSurface: target.sourceSurface,
    userId: target.userId ?? target.initiatedByUserId ?? target.actorUserId,
  });
}

export async function recordVendorAccessUsed(
  ctx: AuditWriterCtx,
  target: VendorAuditTarget,
  args: {
    context?: VendorAuditContext;
    decision: Pick<VendorBoundaryDecision, 'dataClasses' | 'vendor'>;
    operation: string;
    outcome?: 'failure' | 'success';
    severity?: 'critical' | 'info' | 'warning';
  },
) {
  await recordVendorAuditEvent(ctx, target, {
    context: args.context,
    dataClasses: args.decision.dataClasses,
    eventType: 'outbound_vendor_access_used',
    operation: args.operation,
    outcome: args.outcome ?? 'success',
    severity: args.severity ?? (args.outcome === 'failure' ? 'warning' : 'info'),
    vendor: args.decision.vendor,
  });
}

export async function recordVendorAccessDenied(
  ctx: AuditWriterCtx,
  target: VendorAuditTarget,
  args: {
    context?: VendorAuditContext;
    dataClasses: readonly VendorDataClass[];
    error: VendorBoundaryError;
    operation: string;
    vendor: VendorKey;
  },
) {
  await recordVendorAuditEvent(ctx, target, {
    context: mergeVendorAuditContext(args.context, {
      reason: args.error.message,
      violation: args.error.violation,
      violatedValues: args.error.violatedValues.join(','),
    }),
    dataClasses: args.dataClasses,
    eventType: 'outbound_vendor_access_denied',
    operation: args.operation,
    outcome: 'failure',
    severity: 'warning',
    vendor: args.vendor,
  });
}

export async function executeVendorOperation<T>(
  ctx: AuditWriterCtx,
  target: VendorAuditTarget,
  args: {
    context?: VendorAuditContext;
    dataClasses: VendorDataClass[];
    execute: (decision: VendorBoundaryDecision) => Promise<T>;
    operation: string;
    resolveUsedAudit?: (result: T) => VendorAccessUsedAudit | undefined;
    vendor: VendorKey;
  },
): Promise<T> {
  try {
    const decision = resolveVendorBoundaryDecision({
      vendor: args.vendor,
      dataClasses: args.dataClasses,
    });
    const result = await args.execute(decision);
    const usedAudit = args.resolveUsedAudit?.(result);
    await recordVendorAccessUsed(ctx, target, {
      decision,
      operation: args.operation,
      context: mergeVendorAuditContext(args.context, usedAudit?.context),
      outcome: usedAudit?.outcome,
      severity: usedAudit?.severity,
    });
    return result;
  } catch (error) {
    if (error instanceof VendorBoundaryError) {
      await recordVendorAccessDenied(ctx, target, {
        context: args.context,
        dataClasses: args.dataClasses,
        error,
        operation: args.operation,
        vendor: args.vendor,
      });
    }
    throw error;
  }
}
