import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
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
 * Uses Convex hooks directly for real-time updates
 */
export function useAdminDashboard() {
  // Use Convex queries directly - enables real-time updates automatically
  const usersData = useQuery(api.admin.getAllUsers, {
    page: 1,
    pageSize: 50,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    secondarySortBy: 'name',
    secondarySortOrder: 'asc',
    search: undefined,
    role: 'all',
  });

  const statsData = useQuery(api.admin.getSystemStats);

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

  // Truncate data mutation - using Convex mutation directly
  const truncateMutation = useMutation(api.admin.truncateData);

  const handleTruncateData = async () => {
    try {
      const result = await truncateMutation();
      setTruncateResult(result);
      // Convex automatically updates queries when data changes - no cache invalidation needed!
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
    users: usersData,
    stats: statsData,
    isLoadingUsers: usersData === undefined,
    isLoadingStats: statsData === undefined,
    usersError: null, // Convex handles errors via error boundaries
    statsError: null, // Convex handles errors via error boundaries

    // UI state
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    isTruncating: false, // Convex mutations don't expose pending state in the same way

    // Actions
    handleTruncateData,
  };
}
