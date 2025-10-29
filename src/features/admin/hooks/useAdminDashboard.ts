import { useQuery, useQueryClient } from '@tanstack/react-query';
// Convex imports for truncate mutation
import { useMutation as useConvexMutation } from 'convex/react';
import { useEffect, useState } from 'react';
import { getAllUsersServerFn, getSystemStatsServerFn } from '~/features/dashboard/admin.server';
import { queryInvalidators, queryKeys } from '~/lib/query-keys';
import { api } from '../../../../convex/_generated/api';

type TruncateResult = {
  success: boolean;
  message: string;
  truncatedTables?: number;
  failedTables?: number;
  totalTables?: number;
  failedTableNames?: string[];
  invalidateAllCaches?: boolean;
};

/**
 * Custom hook for admin dashboard data and operations
 * Properly handles loader data hydration and client-side queries
 */
export function useAdminDashboard(initialUsersData?: unknown, initialStats?: unknown) {
  const queryClient = useQueryClient();

  // Hydrate preloaded data from loader into React Query cache
  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users.list(),
    queryFn: () =>
      getAllUsersServerFn({
        data: { page: 1, pageSize: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      }),
    initialData: initialUsersData,
    staleTime: 5 * 60 * 1000, // 5 minutes for user data
  });

  const statsQuery = useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: () => getSystemStatsServerFn(),
    initialData: initialStats,
    staleTime: 30 * 1000, // 30 seconds for stats
  });

  // Local state for UI interactions
  const [showTruncateModal, setShowTruncateModal] = useState(false);
  const [truncateResult, setTruncateResult] = useState<TruncateResult | null>(null);

  // Auto-dismiss truncate result after 10 seconds
  useEffect(() => {
    if (truncateResult) {
      const timer = setTimeout(() => {
        setTruncateResult(null);
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [truncateResult]);

  // Truncate data mutation - migrated to Convex
  const truncateMutation = useConvexMutation(api.admin.truncateData);

  const handleTruncateData = async () => {
    try {
      const result = await truncateMutation();
      setTruncateResult(result);

      // Invalidate caches if requested by the operation
      if (result.invalidateAllCaches) {
        console.log('🔄 Invalidating relevant React Query caches after data truncation');
        queryInvalidators.composites.completeRefresh(queryClient);
        queryInvalidators.dashboard.all(queryClient);
      }

      setShowTruncateModal(false);
    } catch (error) {
      setTruncateResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to truncate data',
      });
    }
  };

  return {
    // Data
    users: usersQuery.data,
    stats: statsQuery.data,
    isLoadingUsers: usersQuery.isLoading,
    isLoadingStats: statsQuery.isLoading,
    usersError: usersQuery.error,
    statsError: statsQuery.error,

    // UI state
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    isTruncating: false, // Convex mutations don't have pending state in the same way

    // Actions
    handleTruncateData,
  };
}
