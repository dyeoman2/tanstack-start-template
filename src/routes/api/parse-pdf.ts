import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to parse PDF';
}

async function getPdfParseBackendMode() {
  return await convexAuthReactStart.fetchAuthAction(api.pdfParseActions.getPdfParseBackendMode, {});
}

async function recordDirectPdfParseAuditEvent(input: {
  eventType: 'pdf_parse_requested' | 'pdf_parse_succeeded' | 'pdf_parse_failed';
  metadata?: string;
  organizationId?: string;
  requestId?: string;
  resourceId?: string;
  resourceLabel?: string;
  outcome?: 'success' | 'failure';
  severity?: 'info' | 'warning' | 'critical';
  resourceType?: string;
  sourceSurface?: string;
}) {
  await convexAuthReactStart.fetchAuthAction(api.pdfParseActions.recordDirectPdfParseAuditEvent, {
    eventType: input.eventType,
    metadata: input.metadata,
    organizationId: input.organizationId,
    requestId: input.requestId,
    resourceId: input.resourceId,
    resourceLabel: input.resourceLabel,
    outcome: input.outcome,
    severity: input.severity,
    resourceType: input.resourceType,
    sourceSurface: input.sourceSurface,
  });
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

          if ((await getPdfParseBackendMode()) === 'convex') {
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
        let currentProfile:
          | Awaited<
              ReturnType<
                typeof convexAuthReactStart.fetchAuthQuery<typeof api.users.getCurrentUserProfile>
              >
            >
          | null
          | undefined;
        let organizationId: string | undefined;

        try {
          currentProfile = await convexAuthReactStart.fetchAuthQuery(
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

          const backendMode = await getPdfParseBackendMode();
          if (backendMode === 'convex') {
            return Response.json(
              {
                error:
                  'Direct in-process PDF parsing is disabled. Use S3-backed storage and submit a storageId-backed parse job instead.',
              },
              { status: 405 },
            );
          }

          const payload = (await request.json().catch(() => null)) as {
            storageId?: unknown;
          } | null;
          const storageId =
            payload && typeof payload.storageId === 'string' ? payload.storageId.trim() : '';

          if (!storageId) {
            return Response.json({ error: 'storageId is required' }, { status: 400 });
          }

          await recordDirectPdfParseAuditEvent({
            eventType: 'pdf_parse_requested',
            metadata: JSON.stringify({
              storageId,
            }),
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
        } catch (error) {
          await convexAuthReactStart
            .fetchAuthAction(api.pdfParseActions.recordDirectPdfParseAuditEvent, {
              eventType: 'pdf_parse_failed',
              metadata: JSON.stringify({
                error: getErrorMessage(error),
              }),
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
