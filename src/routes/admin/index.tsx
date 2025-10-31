import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '~/components/PageHeader';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { useAdminDashboard } from '~/features/admin/hooks/useAdminDashboard';
import { routeAdminGuard } from '~/features/auth/server/route-guards';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';
import { AdminCardsGrid } from '../../features/admin/components/AdminCardsGrid';
import { TruncateDataModal } from '../../features/admin/components/TruncateDataModal';
import { TruncateResultAlert } from '../../features/admin/components/TruncateResultAlert';

export const Route = createFileRoute('/admin/')({
  beforeLoad: routeAdminGuard,
  component: AdminDashboardIndex,
  errorComponent: AdminErrorBoundary,
});

function AdminDashboardIndex() {
  usePerformanceMonitoring('AdminDashboard');

  const {
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    isTruncating,
    handleTruncateData,
  } = useAdminDashboard();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Dashboard"
        description="Overview of system administration and management tools."
      />

      <TruncateResultAlert truncateResult={truncateResult} />

      <AdminCardsGrid onTruncateClick={() => setShowTruncateModal(true)} />

      <TruncateDataModal
        isOpen={showTruncateModal}
        onClose={() => setShowTruncateModal(false)}
        onConfirm={handleTruncateData}
        isTruncating={isTruncating}
      />
    </div>
  );
}
