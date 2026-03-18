import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { api, internal } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';
import { inspectFile } from '~/lib/server/file-inspection.server';
import { logSecurityEvent } from '~/lib/server/observability.server';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const WORKER_PATH = join(
  process.cwd(),
  'node_modules',
  'pdf-parse',
  'dist',
  'worker',
  'pdf.worker.mjs',
);
const WORKER_URL = pathToFileURL(WORKER_PATH).href;
const CANVAS_MODULE_NAME = '@napi-rs/canvas';
const PDF_PARSE_MODULE_NAME = 'pdf-parse';

let isWorkerConfigured = false;

export const Route = createFileRoute('/api/parse-pdf')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();
        try {
          const currentProfile = await convexAuthReactStart.fetchAuthQuery(
            api.users.getCurrentUserProfile,
            {},
          );
          if (!currentProfile) {
            return Response.json({ error: 'Authentication required' }, { status: 401 });
          }

          try {
            await convexAuthReactStart.fetchAuthAction(api.auth.enforcePdfParseRateLimit, {});
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Too many PDF parse requests';
            return Response.json({ error: message }, { status: 429 });
          }

          const formData = await request.formData();
          const fileValue = formData.get('file');

          if (!fileValue || typeof fileValue === 'string') {
            return Response.json({ error: 'No file provided' }, { status: 400 });
          }

          const file = fileValue;
          await createConvexAdminClient().action(internal.audit.recordClientAuditEvent, {
            eventType: 'pdf_parse_requested',
            organizationId: currentProfile.currentOrganization?.id ?? undefined,
            outcome: 'success',
            severity: 'info',
            resourceType: 'pdf_file',
            resourceLabel: file.name,
            sourceSurface: 'api.parse_pdf',
            requestId,
            metadata: {
              mimeType: file.type,
              sizeBytes: file.size,
            },
          });

          if (typeof globalThis.DOMMatrix === 'undefined') {
            const { DOMMatrix, DOMPoint, DOMRect } = await import(
              /* @vite-ignore */ CANVAS_MODULE_NAME
            );
            const globalWithDom = globalThis as Record<string, unknown>;

            globalWithDom.DOMMatrix = DOMMatrix;
            globalWithDom.DOMPoint = DOMPoint;
            globalWithDom.DOMRect = DOMRect;
          }

          const { PDFParse } = await import(/* @vite-ignore */ PDF_PARSE_MODULE_NAME);
          if (!isWorkerConfigured) {
            PDFParse.setWorker(WORKER_URL);
            isWorkerConfigured = true;
          }

          const blob = new Blob([await file.arrayBuffer()], {
            type: file.type || 'application/pdf',
          });
          const inspection = await inspectFile({
            allowedKinds: ['pdf'],
            blob,
            fileName: file.name,
            maxBytes: MAX_FILE_SIZE,
            mimeType: file.type || 'application/pdf',
          });

          await createConvexAdminClient().mutation(
            internal.security.recordDocumentScanEventInternal,
            {
              details: inspection.details ?? null,
              fileName: file.name,
              mimeType: file.type || 'application/pdf',
              organizationId: currentProfile.currentOrganization?.id ?? 'unknown',
              requestedByUserId: currentProfile.id,
              resultStatus: inspection.status,
              scannedAt: inspection.inspectedAt,
              scannerEngine: inspection.engine,
            },
          );

          if (inspection.status === 'rejected') {
            return Response.json(
              { error: inspection.details ?? 'File rejected during inspection' },
              { status: 400 },
            );
          }

          if (inspection.status === 'inspection_failed') {
            return Response.json(
              { error: inspection.details ?? 'File inspection failed' },
              { status: 500 },
            );
          }

          if (inspection.status === 'quarantined') {
            logSecurityEvent({
              actorUserId: currentProfile.id,
              data: {
                engine: inspection.engine,
                fileExtension: file.name.split('.').pop()?.toLowerCase() ?? 'unknown',
                reason: inspection.details ?? 'file_signature_mismatch',
                resultStatus: inspection.status,
              },
              event: 'pdf.parse.quarantined',
              scope: 'scan',
              status: 'warning',
            });
            return Response.json(
              { error: inspection.details ?? 'File quarantined during file inspection' },
              { status: 422 },
            );
          }

          const buffer = Buffer.from(await blob.arrayBuffer());

          const parser = new PDFParse({ data: buffer });
          const textResult = await parser.getText();
          const imageResult = await parser.getImage({ imageThreshold: 50 });

          await parser.destroy();

          const images = imageResult.pages.flatMap(
            (page: {
              pageNumber: number;
              images: Array<{
                name: string;
                width: number;
                height: number;
                dataUrl: string;
              }>;
            }) =>
              page.images.map((image) => ({
                pageNumber: page.pageNumber,
                name: image.name,
                width: image.width,
                height: image.height,
                dataUrl: image.dataUrl,
              })),
          );

          await createConvexAdminClient().action(internal.audit.recordClientAuditEvent, {
            eventType: 'pdf_parse_succeeded',
            organizationId: currentProfile.currentOrganization?.id ?? undefined,
            outcome: 'success',
            severity: 'info',
            resourceType: 'pdf_file',
            resourceLabel: file.name,
            sourceSurface: 'api.parse_pdf',
            requestId,
            metadata: {
              pageCount: textResult.total,
              imageCount: images.length,
            },
          });

          return Response.json({
            success: true,
            name: file.name,
            content: textResult.text,
            pages: textResult.total,
            images,
          });
        } catch (error) {
          await createConvexAdminClient()
            .action(internal.audit.recordClientAuditEvent, {
              eventType: 'pdf_parse_failed',
              outcome: 'failure',
              severity: 'warning',
              resourceType: 'pdf_file',
              sourceSurface: 'api.parse_pdf',
              requestId,
              metadata: {
                error: error instanceof Error ? error.message : 'Failed to parse PDF',
              },
            })
            .catch(() => undefined);
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : 'Failed to parse PDF',
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
