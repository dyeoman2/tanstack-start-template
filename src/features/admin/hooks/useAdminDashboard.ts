import { api } from '@convex/_generated/api';
import { useAction, useMutation, useQuery } from 'convex/react';
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

type ModelCatalogRefreshResult = {
  success: boolean;
  message: string;
};

/**
 * Custom hook for admin dashboard data and operations
 * Uses Convex hooks directly for real-time updates
 */
export function useAdminDashboard() {
  // Local state for UI interactions
  const [showTruncateModal, setShowTruncateModal] = useState(false);
  const [truncateResult, setTruncateResult] = useState<TruncateResult | null>(null);
  const [modelCatalogResult, setModelCatalogResult] = useState<ModelCatalogRefreshResult | null>(
    null,
  );
  const [isTruncating, setIsTruncating] = useState(false);
  const [isMutatingModels, setIsMutatingModels] = useState(false);

  // Auto-dismiss truncate result after 10 seconds
  useEffect(() => {
    if (truncateResult) {
      const timer = setTimeout(() => {
        setTruncateResult(null);
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [truncateResult]);

  useEffect(() => {
    if (modelCatalogResult) {
      const timer = setTimeout(() => {
        setModelCatalogResult(null);
      }, 10000);

      return () => clearTimeout(timer);
    }
  }, [modelCatalogResult]);

  // Truncate data mutation - using Convex mutation directly
  const truncateMutation = useMutation(api.admin.truncateData);
  const modelCatalogStatus = useQuery(api.admin.getChatModelCatalogStatus, {});
  const modelCatalog = useQuery(api.admin.listChatModelCatalog, {});
  const createChatModel = useMutation(api.admin.createChatModel);
  const updateChatModel = useMutation(api.admin.updateChatModel);
  const setChatModelActiveState = useMutation(api.admin.setChatModelActiveState);
  const importTopFreeModels = useAction(api.adminModelImports.importTopFreeModels);
  const importTopPaidModels = useAction(api.adminModelImports.importTopPaidModels);

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

  const handleCreateModel = async (
    args: Parameters<typeof createChatModel>[0],
  ) => {
    setIsMutatingModels(true);
    try {
      const result = await createChatModel(args);
      setModelCatalogResult(result);
      return result;
    } catch (error) {
      setModelCatalogResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create AI model',
      });
      throw error;
    } finally {
      setIsMutatingModels(false);
    }
  };

  const handleUpdateModel = async (
    args: Parameters<typeof updateChatModel>[0],
  ) => {
    setIsMutatingModels(true);
    try {
      const result = await updateChatModel(args);
      setModelCatalogResult(result);
      return result;
    } catch (error) {
      setModelCatalogResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update AI model',
      });
      throw error;
    } finally {
      setIsMutatingModels(false);
    }
  };

  const handleSetModelActiveState = async (
    args: Parameters<typeof setChatModelActiveState>[0],
  ) => {
    setIsMutatingModels(true);
    try {
      const result = await setChatModelActiveState(args);
      setModelCatalogResult(result);
      return result;
    } catch (error) {
      setModelCatalogResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update AI model state',
      });
      throw error;
    } finally {
      setIsMutatingModels(false);
    }
  };

  const handleImportTopFreeModels = async () => {
    setIsMutatingModels(true);
    try {
      const result = await importTopFreeModels({});
      setModelCatalogResult(result);
      return result;
    } catch (error) {
      setModelCatalogResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to import free AI models',
      });
      throw error;
    } finally {
      setIsMutatingModels(false);
    }
  };

  const handleImportTopPaidModels = async () => {
    setIsMutatingModels(true);
    try {
      const result = await importTopPaidModels({});
      setModelCatalogResult(result);
      return result;
    } catch (error) {
      setModelCatalogResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to import paid AI models',
      });
      throw error;
    } finally {
      setIsMutatingModels(false);
    }
  };

  return {
    showTruncateModal,
    setShowTruncateModal,
    truncateResult,
    modelCatalogResult,
    modelCatalogStatus,
    modelCatalog,
    isTruncating,
    isMutatingModels,
    handleTruncateData,
    handleCreateModel,
    handleUpdateModel,
    handleSetModelActiveState,
    handleImportTopFreeModels,
    handleImportTopPaidModels,
  };
}
