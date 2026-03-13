import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { z } from 'zod';
import { PageHeader } from '~/components/PageHeader';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { AdminEmailPreviewPage } from '~/features/admin/components/AdminEmailPreviewPage';
import {
  AVAILABLE_EMAIL_TEMPLATE_IDS,
  EMAIL_PREVIEW_TEMPLATES,
  resolveEmailPreviewSelection,
} from '~/features/admin/lib/email-preview-registry';
import { renderEmailPreviewServerFn } from '~/features/admin/server/email-previews';

const emailPreviewSearchSchema = z.object({
  template: z.enum(AVAILABLE_EMAIL_TEMPLATE_IDS).optional(),
  scenario: z.string().optional(),
});

export const Route = createFileRoute('/app/admin/emails')({
  validateSearch: emailPreviewSearchSchema,
  component: AdminEmailPreviewRoute,
  errorComponent: AdminErrorBoundary,
});

function AdminEmailPreviewRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const selection = resolveEmailPreviewSelection(search);
  const isCanonical =
    search.template === selection.template && search.scenario === selection.scenario;

  useEffect(() => {
    if (isCanonical) {
      return;
    }

    void navigate({
      to: '/app/admin/emails',
      search: selection,
      replace: true,
    });
  }, [isCanonical, navigate, selection]);

  const previewQuery = useQuery({
    queryKey: ['admin-email-preview', selection.template, selection.scenario],
    queryFn: () => renderEmailPreviewServerFn({ data: selection }),
  });

  if (previewQuery.error) {
    throw previewQuery.error;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Previews"
        description="Preview the final rendered transactional emails used by authentication and invitation flows."
      />

      <AdminEmailPreviewPage
        templates={EMAIL_PREVIEW_TEMPLATES}
        selectedTemplateId={selection.template}
        selectedScenarioId={selection.scenario}
        preview={previewQuery.data ?? null}
        isLoading={previewQuery.isLoading || (previewQuery.isFetching && !previewQuery.data)}
        onTemplateChange={(template) => {
          const nextSelection = resolveEmailPreviewSelection({
            template,
            scenario: undefined,
          });

          void navigate({
            to: '/app/admin/emails',
            search: nextSelection,
          });
        }}
        onScenarioChange={(scenario) => {
          void navigate({
            to: '/app/admin/emails',
            search: {
              template: selection.template,
              scenario,
            },
          });
        }}
      />
    </div>
  );
}
