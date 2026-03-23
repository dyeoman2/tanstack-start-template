'use node';

import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { action, internalAction } from './_generated/server';
import {
  getVerifiedCurrentUserFromActionOrThrow,
  requireStorageReadAccessFromActionOrThrow,
} from './auth/access';
import { getS3Object } from './lib/storageS3';
import { getStorageReadiness } from './storageReadiness';
import { parsePdfBlob } from '../src/lib/server/pdf-parse.server';

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

function asConvexStorageId(storageId: string) {
  return storageId as Id<'_storage'>;
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
    resultStorageId?: Id<'_storage'> | null;
    status: 'failed' | 'processing' | 'quarantined' | 'queued' | 'ready';
    storageId: string;
    updatedAt: number;
  },
) {
  await ctx.runMutation(internal.pdfParse.upsertPdfParseJobInternal, args);
}

async function loadPdfSourceBlob(
  ctx: ActionCtx,
  lifecycle: Pick<
    Doc<'storageLifecycle'>,
    'backendMode' | 'canonicalBucket' | 'canonicalKey' | 'storageId'
  >,
) {
  if (lifecycle.backendMode === 's3-primary') {
    if (!lifecycle.canonicalBucket || !lifecycle.canonicalKey) {
      throw new ConvexError('Stored file does not have an S3 backing object.');
    }
    const object = await getS3Object({
      bucket: lifecycle.canonicalBucket,
      key: lifecycle.canonicalKey,
    });
    const body = object.Body;
    if (!body) {
      throw new ConvexError('Stored file was not found.');
    }
    if (body instanceof Blob) {
      return body;
    }
    if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
      const bytes = await (
        body as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy], { type: 'application/pdf' });
    }
    if (typeof body === 'object' && body !== null && 'transformToString' in body) {
      const text = await (body as { transformToString: () => Promise<string> }).transformToString();
      return new Blob([text], { type: 'application/pdf' });
    }
    throw new ConvexError('Stored file body could not be converted to a blob.');
  }

  const blob = await ctx.storage.get(asConvexStorageId(lifecycle.storageId));
  if (!blob) {
    throw new ConvexError('Stored file was not found.');
  }
  return blob;
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
      const resultStorageId = await ctx.storage.store(
        new Blob([JSON.stringify(parsed)], { type: 'application/json' }),
      );

      if (job.resultStorageId) {
        await ctx.storage.delete(job.resultStorageId);
      }

      await patchPdfParseJob(ctx, {
        completedAt: Date.now(),
        errorMessage: null,
        organizationId: job.organizationId,
        requestedByUserId: job.requestedByUserId,
        resultStorageId,
        status: 'ready',
        storageId: args.storageId,
        updatedAt: Date.now(),
      });

      await ctx.runMutation(internal.audit.insertAuditLog, {
        actorUserId: job.requestedByUserId,
        eventType: 'pdf_parse_succeeded',
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
      await ctx.runMutation(internal.audit.insertAuditLog, {
        actorUserId: job.requestedByUserId,
        eventType: 'pdf_parse_failed',
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
      organizationId: user.activeOrganizationId ?? 'unknown',
      requestedByUserId: user.authUserId,
      resultStorageId: null,
      status: readiness.reason === 'quarantined' ? 'quarantined' : 'queued',
      storageId: args.storageId,
      updatedAt: Date.now(),
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

    const resultBlob = await ctx.storage.get(job.resultStorageId);
    if (!resultBlob) {
      throw new ConvexError('PDF parse result not found.');
    }

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
