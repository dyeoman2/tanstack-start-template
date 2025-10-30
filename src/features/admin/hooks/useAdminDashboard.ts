import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../../../../convex/_generated/api';
import type { AdminDashboardLoaderData } from '../server/dashboard.server';

/**
 * Result type from truncateData mutation
 * Matches the return type from convex/admin.ts truncateData mutation
 */
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
export function useAdminDashboard(initialData: AdminDashboardLoaderData) {
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
    cursor: undefined, // Add cursor for optimized pagination
  });

  const statsData = useQuery(api.admin.getSystemStats);

  const fallbackUsers =
    initialData.status === 'success' || initialData.status === 'partial' ? initialData.users : null;
  const fallbackStats =
    initialData.status === 'success' || initialData.status === 'partial' ? initialData.stats : null;
  const loaderUsersError =
    initialData.status === 'error'
      ? initialData.error
      : initialData.status === 'partial'
        ? (initialData.usersError ?? null)
        : null;
  const loaderStatsError =
    initialData.status === 'error'
      ? initialData.error
      : initialData.status === 'partial'
        ? (initialData.statsError ?? null)
        : null;

  const users = usersData ?? fallbackUsers ?? null;
  const stats = statsData ?? fallbackStats ?? null;
  const hasInitialUsers = fallbackUsers !== null;
  const hasInitialStats = fallbackStats !== null;
  const shouldWaitForUsers = !hasInitialUsers && loaderUsersError === null;
  const shouldWaitForStats = !hasInitialStats && loaderStatsError === null;
  const isLoadingUsers = usersData === undefined && shouldWaitForUsers;
  const isLoadingStats = statsData === undefined && shouldWaitForStats;

  // Local state for UI interactions
  const [showTruncateModal, setShowTruncateModal] = useState(false);
  const [truncateResult, setTruncateResult] = useState<TruncateResult | null>(null);
  const [isTruncating, setIsTruncating] = useState(false);

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
    setIsTruncating(true);
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
    } finally {
      setIsTruncating(false);
    }
  };

  return {
    // Data
    users,
    stats,
    isLoadingUsers,
    isLoadingStats,
    usersError: loaderUsersError,
    statsError: loaderStatsError,

    // UI state
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    isTruncating, // Tracked manually via useState

    // Actions
    handleTruncateData,
  };
}
