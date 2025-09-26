import { createFileRoute } from '@tanstack/react-router';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import { useAdminDashboard } from '~/features/admin/hooks/useAdminDashboard';
import { routeAdminGuard } from '~/features/auth/server/route-guards';
import { getAllUsersServerFn, getSystemStatsServerFn } from '~/features/dashboard/admin.server';
import { AdminCardsGrid } from '../../features/admin/components/AdminCardsGrid';
import { AdminDashboardHeader } from '../../features/admin/components/AdminDashboardHeader';
import { TruncateDataModal } from '../../features/admin/components/TruncateDataModal';
import { TruncateResultAlert } from '../../features/admin/components/TruncateResultAlert';

export const Route = createFileRoute('/admin/')({
  beforeLoad: routeAdminGuard,
  loader: async () => {
    const [users, stats] = await Promise.all([getAllUsersServerFn(), getSystemStatsServerFn()]);
    return { users, stats };
  },
  component: AdminDashboardIndex,
  errorComponent: AdminErrorBoundary,
});

function AdminDashboardIndex() {
  // Get preloaded data from loader to eliminate waterfalls
  const loaderData = Route.useLoaderData();

  // Use custom hook for all admin dashboard logic
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
  } = useAdminDashboard(loaderData.users, loaderData.stats);

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

  // Show error state if either query failed
  if (usersError || statsError) {
    return (
      <ErrorBoundaryWrapper
        title="Admin Dashboard Error"
        description="Failed to load admin dashboard data. This might be due to a temporary system issue."
      >
        <div className="px-4 py-8">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Data Loading Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <ul className="list-disc pl-5 space-y-1">
                    {usersError && <li>Failed to load users: {usersError.message}</li>}
                    {statsError && <li>Failed to load system stats: {statsError.message}</li>}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ErrorBoundaryWrapper>
    );
  }

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
          confirmText={confirmText}
          onConfirmTextChange={setConfirmText}
          onConfirm={handleTruncateData}
          isTruncating={isTruncating}
        />
      </div>
    </ErrorBoundaryWrapper>
  );
}
