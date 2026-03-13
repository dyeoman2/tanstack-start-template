import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '~/components/PageHeader';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { ModelCatalogManager } from '~/features/admin/components/ModelCatalogManager';
import { ModelCatalogResultAlert } from '~/features/admin/components/ModelCatalogResultAlert';
import { useAdminModelCatalog } from '~/features/admin/hooks/useAdminModelCatalog';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/admin/models')({
  component: AdminModelCatalogRoute,
  errorComponent: AdminErrorBoundary,
});

function AdminModelCatalogRoute() {
  usePerformanceMonitoring('AdminModelCatalog');

  const {
    modelCatalogResult,
    modelCatalog,
    isMutatingModels,
    handleCreateModel,
    handleUpdateModel,
    handleSetModelActiveState,
    handleImportTopFreeModels,
    handleImportTopPaidModels,
  } = useAdminModelCatalog();

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Model Catalog"
        description="Manage the curated OpenRouter models available in the chat workspace."
      />

      <ModelCatalogResultAlert result={modelCatalogResult} />

      <ModelCatalogManager
        models={modelCatalog}
        isMutating={isMutatingModels}
        onCreateModel={handleCreateModel}
        onUpdateModel={handleUpdateModel}
        onSetModelActiveState={handleSetModelActiveState}
        onImportTopFreeModels={handleImportTopFreeModels}
        onImportTopPaidModels={handleImportTopPaidModels}
      />
    </div>
  );
}
