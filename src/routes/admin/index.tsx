import { createFileRoute } from '@tanstack/react-router';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { useAdminDashboard } from '~/features/admin/hooks/useAdminDashboard';
import { routeAdminGuard } from '~/features/auth/server/route-guards';
import { AdminCardsGrid } from '../../features/admin/components/AdminCardsGrid';
import { AdminDashboardHeader } from '../../features/admin/components/AdminDashboardHeader';
import { TruncateDataModal } from '../../features/admin/components/TruncateDataModal';
import { TruncateResultAlert } from '../../features/admin/components/TruncateResultAlert';

export const Route = createFileRoute('/admin/')({
  beforeLoad: routeAdminGuard,
  component: AdminDashboardIndex,
  errorComponent: AdminErrorBoundary,
});

function AdminDashboardIndex() {
  const {
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    isTruncating,
    handleTruncateData,
  } = useAdminDashboard();

  return (
    <ErrorBoundaryWrapper
      title="Admin Dashboard Error"
      description="Failed to load admin dashboard. This might be due to a temporary system issue."
    >
      <div className="px-4 py-8">
        <AdminDashboardHeader />

        <TruncateResultAlert truncateResult={truncateResult} />

        <AdminCardsGrid onTruncateClick={() => setShowTruncateModal(true)} />

        <TruncateDataModal
          isOpen={showTruncateModal}
          onClose={() => setShowTruncateModal(false)}
          onConfirm={handleTruncateData}
          isTruncating={isTruncating}
        />
      </div>
    </ErrorBoundaryWrapper>
  );
}
