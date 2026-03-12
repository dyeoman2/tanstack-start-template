import { AdminCard } from './AdminCard';

interface AdminCardsGridProps {
  onTruncateClick: () => void;
  onRefreshModelsClick: () => void;
  isRefreshingModels: boolean;
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
  onRefreshModelsClick,
  isRefreshingModels,
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
        title={isRefreshingModels ? 'Refreshing AI Models...' : 'Refresh AI Models'}
        description={
          modelCatalogStatus
            ? `${modelCatalogStatus.activeModelsCount} cached models. ${formatLastRefreshed(
                modelCatalogStatus.lastRefreshedAt,
              )}`
            : 'Sync the Cloudflare catalog for admin chat model options'
        }
        onClick={onRefreshModelsClick}
        disabled={isRefreshingModels}
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
