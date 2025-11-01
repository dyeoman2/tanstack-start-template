import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import { useEffect, useState } from 'react';

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
export function useAdminDashboard() {
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
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    isTruncating,
    handleTruncateData,
  };
}
