'use node';

import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { action, internalAction } from './_generated/server';
import {
  getVerifiedCurrentUserFromActionOrThrow,
  requireStorageReadAccessFromActionOrThrow,
} from './auth/access';
import {
  deleteStoredFileWithMode,
  loadStoredFileBlobWithMode,
  storeDerivedFileWithMode,
} from './storagePlatform';
import { getStorageReadiness } from './storageReadiness';
import { parsePdfBlob } from '../src/lib/server/pdf-parse.server';
import { recordSystemAuditEvent, recordUserAuditEvent } from './lib/auditEmitters';

const pdfParseJobStatusValidator = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('ready'),
  v.literal('failed'),
  v.literal('quarantined'),
);

const parsedPdfImageValidator = v.object({
  dataUrl: v.string(),
  height: v.number(),
  name: v.string(),
  pageNumber: v.number(),
  width: v.number(),
});

const PDF_PARSE_ENQUEUE_RATE_LIMIT = {
  kind: 'token bucket' as const,
  rate: 10,
  period: 5 * 60 * 1000,
  capacity: 10,
};

const PDF_PARSE_STATUS_RATE_LIMIT = {
  kind: 'fixed window' as const,
  rate: 60,
  period: 60 * 1000,
  capacity: 60,
};

const PDF_PARSE_AUDIT_EVENT_RATE_LIMIT = {
  kind: 'token bucket' as const,
  rate: 30,
  period: 5 * 60 * 1000,
  capacity: 30,
};

async function enforcePdfParseActionRateLimit(
  ctx: Pick<ActionCtx, 'runAction'>,
  args: {
    authUserId: string;
    limiter:
      | typeof PDF_PARSE_ENQUEUE_RATE_LIMIT
      | typeof PDF_PARSE_STATUS_RATE_LIMIT
      | typeof PDF_PARSE_AUDIT_EVENT_RATE_LIMIT;
    name: string;
    subject: string;
  },
) {
  const result = await ctx.runAction(internal.auth.rateLimitAction, {
    name: args.name,
    key: `${args.name}:${args.authUserId}`,
    config: args.limiter,
  });

  if (!result.ok) {
    throw new ConvexError(
      `${args.subject} rate limit exceeded. Try again in ${Math.max(
        1,
        Math.ceil((result.retryAfter ?? 0) / 1000),
      )} seconds.`,
    );
  }
}

async function getPdfParseJob(
  ctx: Pick<ActionCtx, 'runQuery'>,
  storageId: string,
): Promise<Doc<'pdfParseJobs'> | null> {
  return (await ctx.runQuery(internal.pdfParse.getPdfParseJobByStorageIdInternal, {
    storageId,
  })) as Doc<'pdfParseJobs'> | null;
}

async function patchPdfParseJob(
  ctx: Pick<ActionCtx, 'runMutation'>,
  args: {
    completedAt?: number | null;
    errorMessage?: string | null;
    organizationId: string;
    requestedByUserId: string;
    resultStorageId?: string | null;
    status: 'failed' | 'processing' | 'quarantined' | 'queued' | 'ready';
    storageId: string;
    updatedAt: number;
  },
) {
  await ctx.runMutation(internal.pdfParse.upsertPdfParseJobInternal, args);
}

async function loadPdfSourceBlob(
  ctx: ActionCtx,
  lifecycle: Pick<Doc<'storageLifecycle'>, 'storageId'>,
) {
  return await loadStoredFileBlobWithMode(ctx, {
    fallbackMimeType: 'application/pdf',
    storageId: lifecycle.storageId,
  });
}

export const processPendingPdfParseJobInternal = internalAction({
  args: {
    storageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await getPdfParseJob(ctx, args.storageId);
    if (!job) {
      return null;
    }

    const lifecycle = (await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
      storageId: args.storageId,
    })) as Doc<'storageLifecycle'> | null;
    const readiness = getStorageReadiness(lifecycle);

    if (!lifecycle) {
      await patchPdfParseJob(ctx, {
        completedAt: Date.now(),
        errorMessage: 'Stored file not found.',
        organizationId: job.organizationId,
        requestedByUserId: job.requestedByUserId,
        status: 'failed',
        storageId: args.storageId,
        updatedAt: Date.now(),
      });
      return null;
    }

    if (!readiness.readable) {
      await patchPdfParseJob(ctx, {
        completedAt: readiness.reason === 'quarantined' ? Date.now() : null,
        errorMessage: readiness.reason === 'quarantined' ? readiness.message : null,
        organizationId: job.organizationId,
        requestedByUserId: job.requestedByUserId,
        resultStorageId: null,
        status: readiness.reason === 'quarantined' ? 'quarantined' : 'queued',
        storageId: args.storageId,
        updatedAt: Date.now(),
      });
      return null;
    }

    await patchPdfParseJob(ctx, {
      completedAt: null,
      errorMessage: null,
      organizationId: job.organizationId,
      requestedByUserId: job.requestedByUserId,
      resultStorageId: null,
      status: 'processing',
      storageId: args.storageId,
      updatedAt: Date.now(),
    });

    try {
      const blob = await loadPdfSourceBlob(ctx, lifecycle);
      const parsed = await parsePdfBlob(blob);
      const resultFile = await storeDerivedFileWithMode(ctx, {
        blob: new Blob([JSON.stringify(parsed)], { type: 'application/json' }),
        fileName: `${lifecycle.originalFileName}.parsed.json`,
        mimeType: 'application/json',
        organizationId: lifecycle.organizationId ?? job.organizationId,
        parentStorageId: args.storageId,
        sourceId: args.storageId,
        sourceType: 'pdf_parse_result',
      });

      if (job.resultStorageId) {
        await deleteStoredFileWithMode(ctx, {
          storageId: job.resultStorageId,
        });
      }

      await patchPdfParseJob(ctx, {
        completedAt: Date.now(),
        errorMessage: null,
        organizationId: job.organizationId,
        requestedByUserId: job.requestedByUserId,
        resultStorageId: resultFile.storageId,
        status: 'ready',
        storageId: args.storageId,
        updatedAt: Date.now(),
      });

      await recordSystemAuditEvent(ctx, {
        emitter: 'pdf.parse.worker',
        eventType: 'pdf_parse_succeeded',
        initiatedByUserId: job.requestedByUserId,
        metadata: JSON.stringify({
          imageCount: parsed.images.length,
          pageCount: parsed.pages,
        }),
        organizationId: job.organizationId,
        outcome: 'success',
        resourceId: args.storageId,
        resourceLabel: lifecycle.originalFileName,
        resourceType: 'pdf_file',
        severity: 'info',
        sourceSurface: 'api.parse_pdf',
        userId: job.requestedByUserId,
      });
    } catch (error) {
      await patchPdfParseJob(ctx, {
        completedAt: Date.now(),
        errorMessage: error instanceof Error ? error.message : 'Failed to parse PDF',
        organizationId: job.organizationId,
        requestedByUserId: job.requestedByUserId,
        resultStorageId: null,
        status: 'failed',
        storageId: args.storageId,
        updatedAt: Date.now(),
      });
      await recordSystemAuditEvent(ctx, {
        emitter: 'pdf.parse.worker',
        eventType: 'pdf_parse_failed',
        initiatedByUserId: job.requestedByUserId,
        metadata: JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to parse PDF',
        }),
        organizationId: job.organizationId,
        outcome: 'failure',
        resourceId: args.storageId,
        resourceLabel: lifecycle.originalFileName,
        resourceType: 'pdf_file',
        severity: 'warning',
        sourceSurface: 'api.parse_pdf',
        userId: job.requestedByUserId,
      });
    }

    return null;
  },
});

export const enqueuePdfParseJob = action({
  args: {
    storageId: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal('queued'), v.literal('blocked_pending_scan')),
    storageId: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    await enforcePdfParseActionRateLimit(ctx, {
      authUserId: user.authUserId,
      limiter: PDF_PARSE_ENQUEUE_RATE_LIMIT,
      name: 'pdfParse',
      subject: 'PDF parsing',
    });
    await requireStorageReadAccessFromActionOrThrow(ctx, {
      sourceSurface: 'api.parse_pdf',
      storageId: args.storageId,
    });

    const lifecycle = (await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
      storageId: args.storageId,
    })) as Doc<'storageLifecycle'> | null;
    if (!lifecycle) {
      throw new ConvexError('Stored file not found.');
    }

    const readiness = getStorageReadiness(lifecycle);
    await patchPdfParseJob(ctx, {
      completedAt: readiness.readable
        ? null
        : readiness.reason === 'quarantined'
          ? Date.now()
          : null,
      errorMessage: readiness.reason === 'quarantined' ? readiness.message : null,
      organizationId: lifecycle.organizationId ?? user.activeOrganizationId ?? 'unknown',
      requestedByUserId: user.authUserId,
      resultStorageId: null,
      status: readiness.reason === 'quarantined' ? 'quarantined' : 'queued',
      storageId: args.storageId,
      updatedAt: Date.now(),
    });

    await recordUserAuditEvent(ctx, {
      actorUserId: user.authUserId,
      emitter: 'pdf.parse',
      eventType: 'pdf_parse_requested',
      metadata: JSON.stringify({
        storageId: args.storageId,
      }),
      organizationId: lifecycle.organizationId ?? user.activeOrganizationId ?? 'unknown',
      outcome: 'success',
      resourceId: args.storageId,
      resourceLabel: lifecycle.originalFileName,
      resourceType: 'pdf_file',
      severity: 'info',
      sourceSurface: 'api.parse_pdf',
      userId: user.authUserId,
    });

    if (readiness.readable) {
      await ctx.scheduler.runAfter(0, internal.pdfParseActions.processPendingPdfParseJobInternal, {
        storageId: args.storageId,
      });
      return {
        status: 'queued' as const,
        storageId: args.storageId,
      };
    }

    return {
      status: 'blocked_pending_scan' as const,
      storageId: args.storageId,
    };
  },
});

export const recordDirectPdfParseAuditEvent = action({
  args: {
    eventType: v.union(
      v.literal('pdf_parse_requested'),
      v.literal('pdf_parse_succeeded'),
      v.literal('pdf_parse_failed'),
    ),
    metadata: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    requestId: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    resourceLabel: v.optional(v.string()),
    resourceType: v.optional(v.string()),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    sourceSurface: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    await enforcePdfParseActionRateLimit(ctx, {
      authUserId: user.authUserId,
      limiter: PDF_PARSE_AUDIT_EVENT_RATE_LIMIT,
      name: 'pdfParseAuditEvent',
      subject: 'PDF parse audit event',
    });

    await recordUserAuditEvent(ctx, {
      actorUserId: user.authUserId,
      emitter: 'pdf.parse.route',
      eventType: args.eventType,
      metadata: args.metadata,
      organizationId: args.organizationId ?? user.activeOrganizationId ?? undefined,
      outcome: args.outcome,
      requestId: args.requestId,
      resourceId: args.resourceId,
      resourceLabel: args.resourceLabel,
      resourceType: args.resourceType,
      severity: args.severity,
      sourceSurface: args.sourceSurface ?? 'api.parse_pdf',
      userId: user.authUserId,
    });

    return null;
  },
});

export const getPdfParseJobStatus = action({
  args: {
    storageId: v.string(),
  },
  returns: v.object({
    content: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    images: v.optional(v.array(parsedPdfImageValidator)),
    pages: v.optional(v.number()),
    status: pdfParseJobStatusValidator,
    storageId: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
    await enforcePdfParseActionRateLimit(ctx, {
      authUserId: user.authUserId,
      limiter: PDF_PARSE_STATUS_RATE_LIMIT,
      name: 'pdfParseStatus',
      subject: 'PDF parse status lookup',
    });
    await requireStorageReadAccessFromActionOrThrow(ctx, {
      sourceSurface: 'api.parse_pdf',
      storageId: args.storageId,
    });

    const job = await getPdfParseJob(ctx, args.storageId);
    if (!job) {
      throw new ConvexError('PDF parse job not found.');
    }

    if (job.status !== 'ready' || !job.resultStorageId) {
      return {
        errorMessage: job.errorMessage,
        status: job.status,
        storageId: args.storageId,
      };
    }

    const resultBlob = await loadStoredFileBlobWithMode(ctx, {
      fallbackMimeType: 'application/json',
      storageId: job.resultStorageId,
    });

    const parsed = JSON.parse(await resultBlob.text()) as {
      content: string;
      images: Array<{
        dataUrl: string;
        height: number;
        name: string;
        pageNumber: number;
        width: number;
      }>;
      pages: number;
    };

    return {
      content: parsed.content,
      images: parsed.images,
      pages: parsed.pages,
      status: job.status,
      storageId: args.storageId,
    };
  },
});
