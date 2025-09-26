import { createFileRoute } from '@tanstack/react-router';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { AdminErrorBanner, AdminWarningBanner } from '~/features/admin/components/AdminErrorBanner';
import { useAdminDashboard } from '~/features/admin/hooks/useAdminDashboard';
import { loadAdminData } from '~/features/admin/server/admin-loader.server';
import { routeAdminGuard } from '~/features/auth/server/route-guards';
import { AdminCardsGrid } from '../../features/admin/components/AdminCardsGrid';
import { AdminDashboardHeader } from '../../features/admin/components/AdminDashboardHeader';
import { TruncateDataModal } from '../../features/admin/components/TruncateDataModal';
import { TruncateResultAlert } from '../../features/admin/components/TruncateResultAlert';

export const Route = createFileRoute('/admin/')({
  beforeLoad: routeAdminGuard,
  loader: loadAdminData,
  component: AdminDashboardIndex,
  errorComponent: AdminErrorBoundary,
});

function AdminDashboardIndex() {
  const loaderData = Route.useLoaderData();

  // Extract initial data from loader result
  const initialUsers = loaderData.status !== 'error' ? loaderData.users : undefined;
  const initialStats = loaderData.status !== 'error' ? loaderData.stats : undefined;

  const {
    isLoadingUsers,
    isLoadingStats,
    usersError,
    statsError,
    showTruncateModal,
    setShowTruncateModal,
    confirmText,
    setConfirmText,
    truncateResult,
    isTruncating,
    handleTruncateData,
  } = useAdminDashboard(initialUsers, initialStats);

  // Handle complete failure - show error page
  if (loaderData.status === 'error') {
    return <AdminErrorBanner errors={loaderData.errors} isFullPage />;
  }

  // Show loading state if both queries are loading
  if (isLoadingUsers && isLoadingStats) {
    return (
      <div className="px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-6"></div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 mb-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  // Collect all errors for warning banner
  const allErrors = [
    ...(loaderData.status === 'partial' ? loaderData.errors : []),
    ...(usersError ? [`Users: ${usersError.message}`] : []),
    ...(statsError ? [`Stats: ${statsError.message}`] : []),
  ];

  const hasErrors = allErrors.length > 0;

  return (
    <ErrorBoundaryWrapper
      title="Admin Dashboard Error"
      description="Failed to load admin dashboard. This might be due to a temporary system issue."
    >
      <div className="px-4 py-8">
        <AdminDashboardHeader />

        {/* Show warning banner for any errors */}
        {hasErrors && <AdminWarningBanner errors={allErrors} />}

        <TruncateResultAlert truncateResult={truncateResult} />

        <AdminCardsGrid onTruncateClick={() => setShowTruncateModal(true)} />

        <TruncateDataModal
          isOpen={showTruncateModal}
          onClose={() => setShowTruncateModal(false)}
          confirmText={confirmText}
          onConfirmTextChange={setConfirmText}
          onConfirm={handleTruncateData}
          isTruncating={isTruncating}
        />
      </div>
    </ErrorBoundaryWrapper>
  );
}
