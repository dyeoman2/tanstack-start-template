import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getFileStorageBackendMode } from '~/lib/server/env.server';
import { inspectFile } from '~/lib/server/file-inspection.server';
import { logSecurityEvent } from '~/lib/server/observability.server';
import { parsePdfBlob } from '~/lib/server/pdf-parse.server';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to parse PDF';
}

export const Route = createFileRoute('/api/parse-pdf')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const currentProfile = await convexAuthReactStart.fetchAuthQuery(
            api.users.getCurrentUserProfile,
            {},
          );
          if (!currentProfile) {
            return Response.json({ error: 'Authentication required' }, { status: 401 });
          }

          if (getFileStorageBackendMode() === 'convex') {
            return Response.json(
              { error: 'PDF parse job status is only available for S3-backed storage.' },
              { status: 405 },
            );
          }

          const storageId = new URL(request.url).searchParams.get('storageId')?.trim();
          if (!storageId) {
            return Response.json({ error: 'storageId is required' }, { status: 400 });
          }

          const status = await convexAuthReactStart.fetchAuthAction(
            api.pdfParseActions.getPdfParseJobStatus,
            {
              storageId,
            },
          );
          return Response.json(status);
        } catch (error) {
          return Response.json(
            {
              error: getErrorMessage(error),
            },
            { status: 500 },
          );
        }
      },
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();
        let organizationId: string | undefined;

        try {
          const currentProfile = await convexAuthReactStart.fetchAuthQuery(
            api.users.getCurrentUserProfile,
            {},
          );
          if (!currentProfile) {
            return Response.json({ error: 'Authentication required' }, { status: 401 });
          }
          organizationId = currentProfile.currentOrganization?.id ?? undefined;

          try {
            await convexAuthReactStart.fetchAuthAction(api.auth.enforcePdfParseRateLimit, {});
          } catch (error) {
            return Response.json({ error: getErrorMessage(error) }, { status: 429 });
          }

          const backendMode = getFileStorageBackendMode();
          if (backendMode !== 'convex') {
            const payload = (await request.json().catch(() => null)) as {
              storageId?: unknown;
            } | null;
            const storageId =
              payload && typeof payload.storageId === 'string' ? payload.storageId.trim() : '';

            if (!storageId) {
              return Response.json({ error: 'storageId is required' }, { status: 400 });
            }

            await convexAuthReactStart.fetchAuthAction(api.audit.recordClientAuditEvent, {
              eventType: 'pdf_parse_requested',
              metadata: {
                storageId,
              },
              organizationId,
              outcome: 'success',
              requestId,
              resourceId: storageId,
              resourceType: 'pdf_file',
              severity: 'info',
              sourceSurface: 'api.parse_pdf',
            });

            const queued = await convexAuthReactStart.fetchAuthAction(
              api.pdfParseActions.enqueuePdfParseJob,
              {
                storageId,
              },
            );

            return Response.json(queued, { status: 202 });
          }

          const formData = await request.formData();
          const fileValue = formData.get('file');

          if (!fileValue || typeof fileValue === 'string') {
            return Response.json({ error: 'No file provided' }, { status: 400 });
          }

          const file = fileValue;
          await convexAuthReactStart.fetchAuthAction(api.audit.recordClientAuditEvent, {
            eventType: 'pdf_parse_requested',
            metadata: {
              mimeType: file.type,
              sizeBytes: file.size,
            },
            organizationId,
            outcome: 'success',
            requestId,
            resourceLabel: file.name,
            resourceType: 'pdf_file',
            severity: 'info',
            sourceSurface: 'api.parse_pdf',
          });

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

          if (organizationId) {
            await convexAuthReactStart.fetchAuthMutation(api.securityOps.recordDocumentScanEvent, {
              details: inspection.details ?? null,
              fileName: file.name,
              mimeType: file.type || 'application/pdf',
              organizationId,
              resultStatus: inspection.status,
              scannedAt: inspection.inspectedAt,
              scannerEngine: inspection.engine,
            });
          }

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

          const parsed = await parsePdfBlob(blob);

          await convexAuthReactStart.fetchAuthAction(api.audit.recordClientAuditEvent, {
            eventType: 'pdf_parse_succeeded',
            metadata: {
              imageCount: parsed.images.length,
              pageCount: parsed.pages,
            },
            organizationId,
            outcome: 'success',
            requestId,
            resourceLabel: file.name,
            resourceType: 'pdf_file',
            severity: 'info',
            sourceSurface: 'api.parse_pdf',
          });

          return Response.json({
            success: true,
            name: file.name,
            content: parsed.content,
            pages: parsed.pages,
            images: parsed.images,
          });
        } catch (error) {
          await convexAuthReactStart
            .fetchAuthAction(api.audit.recordClientAuditEvent, {
              eventType: 'pdf_parse_failed',
              metadata: {
                error: getErrorMessage(error),
              },
              organizationId,
              outcome: 'failure',
              requestId,
              resourceType: 'pdf_file',
              severity: 'warning',
              sourceSurface: 'api.parse_pdf',
            })
            .catch(() => undefined);

          return Response.json(
            {
              success: false,
              error: getErrorMessage(error),
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
