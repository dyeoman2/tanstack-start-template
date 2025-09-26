import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { AdminErrorBoundary } from '~/components/RouteErrorBoundaries';
import {
  getAllUsersServerFn,
  getSystemStatsServerFn,
  truncateDataServerFn,
} from '~/features/dashboard/admin.server';
import { ADMIN_KEYS, queryInvalidators } from '~/lib/query-keys';
import { ensureAdminContext } from '~/lib/route-guards';
import { AdminCardsGrid } from '../../features/admin/components/AdminCardsGrid';
import { AdminDashboardHeader } from '../../features/admin/components/AdminDashboardHeader';
import { TruncateDataModal } from '../../features/admin/components/TruncateDataModal';
import { TruncateResultAlert } from '../../features/admin/components/TruncateResultAlert';

type TruncateResult = {
  success: boolean;
  message: string;
  truncatedTables?: number;
  failedTables?: number;
  totalTables?: number;
  failedTableNames?: string[];
  invalidateAllCaches?: boolean;
};

export const Route = createFileRoute('/admin/')({
  beforeLoad: ensureAdminContext,
  loader: async () => {
    const [users, stats] = await Promise.all([getAllUsersServerFn(), getSystemStatsServerFn()]);
    return { users, stats };
  },
  component: AdminDashboardIndex,
  errorComponent: AdminErrorBoundary,
});

function AdminDashboardIndex() {
  // Route is protected by adminGuard in parent route
  const queryClient = useQueryClient();

  // Get preloaded data from loader to eliminate waterfalls
  const loaderData = Route.useLoaderData();

  // Cache the preloaded data in React Query for instant navigation
  useQuery({
    queryKey: ADMIN_KEYS.USERS_ALL,
    queryFn: () => getAllUsersServerFn(),
    initialData: loaderData.users,
    staleTime: 5 * 60 * 1000, // 5 minutes for user data
  });

  useQuery({
    queryKey: ADMIN_KEYS.STATS,
    queryFn: () => getSystemStatsServerFn(),
    initialData: loaderData.stats,
    staleTime: 30 * 1000, // 30 seconds for stats
  });

  const [showTruncateModal, setShowTruncateModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isTruncating, setIsTruncating] = useState(false);
  const [truncateResult, setTruncateResult] = useState<TruncateResult | null>(null);

  // Auto-dismiss the truncate result message after 10 seconds
  useEffect(() => {
    if (truncateResult) {
      const timer = setTimeout(() => {
        setTruncateResult(null);
      }, 10000); // 10 seconds

      return () => clearTimeout(timer);
    }
  }, [truncateResult]);

  const handleTruncateData = async () => {
    if (confirmText !== 'TRUNCATE_ALL_DATA') {
      return;
    }

    setIsTruncating(true);
    try {
      const result = await truncateDataServerFn({ data: { confirmText } });
      setTruncateResult(result);

      // Invalidate specific React Query caches after data truncation using centralized helpers
      if (result.invalidateAllCaches) {
        console.log('🔄 Invalidating relevant React Query caches after data truncation');
        queryInvalidators.composites.completeRefresh(queryClient);
        queryInvalidators.dashboard.all(queryClient);
      }

      setShowTruncateModal(false);
      setConfirmText('');
    } catch (error) {
      setTruncateResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to truncate data',
      });
    } finally {
      setIsTruncating(false);
    }
  };

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
