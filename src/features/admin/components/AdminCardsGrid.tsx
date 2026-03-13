import { AdminCard } from './AdminCard';

interface AdminCardsGridProps {
  onTruncateClick: () => void;
  modelCatalogStatus: {
    activeModelsCount: number;
    publicModelsCount: number;
    adminModelsCount: number;
    lastRefreshedAt: number | null;
  } | undefined;
}

function formatLastRefreshed(lastRefreshedAt: number | null) {
  if (!lastRefreshedAt) {
    return 'No catalog sync yet';
  }

  return `Last refreshed ${new Date(lastRefreshedAt).toLocaleString()}`;
}

export function AdminCardsGrid({
  onTruncateClick,
  modelCatalogStatus,
}: AdminCardsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <AdminCard
        title="User Management"
        description="Manage users and their roles"
        href="/app/admin/users"
      />

      <AdminCard
        title="System Statistics"
        description="View system-wide statistics"
        href="/app/admin/stats"
      />

      <AdminCard
        title="AI Model Catalog"
        description={
          modelCatalogStatus
            ? `${modelCatalogStatus.activeModelsCount} active models, ${modelCatalogStatus.publicModelsCount} public, ${modelCatalogStatus.adminModelsCount} admin-only. ${formatLastRefreshed(
                modelCatalogStatus.lastRefreshedAt,
              )}`
            : 'Manage curated OpenRouter models for the chat workspace'
        }
      />

      <AdminCard
        title="Truncate Data"
        description="Truncate data for testing"
        onClick={onTruncateClick}
        destructive
      />
    </div>
  );
}
