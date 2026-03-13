import { api } from '@convex/_generated/api';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';

type ModelCatalogRefreshResult = {
  success: boolean;
  message: string;
};

export function useAdminModelCatalog() {
  const [modelCatalogResult, setModelCatalogResult] = useState<ModelCatalogRefreshResult | null>(
    null,
  );
  const [isMutatingModels, setIsMutatingModels] = useState(false);

  useEffect(() => {
    if (!modelCatalogResult) {
      return;
    }

    const timer = setTimeout(() => {
      setModelCatalogResult(null);
    }, 10000);

    return () => clearTimeout(timer);
  }, [modelCatalogResult]);

  const modelCatalog = useQuery(api.admin.listChatModelCatalog, {});
  const createChatModel = useMutation(api.admin.createChatModel);
  const updateChatModel = useMutation(api.admin.updateChatModel);
  const setChatModelActiveState = useMutation(api.admin.setChatModelActiveState);
  const importTopFreeModels = useAction(api.adminModelImports.importTopFreeModels);
  const importTopPaidModels = useAction(api.adminModelImports.importTopPaidModels);

  const handleCreateModel = async (args: Parameters<typeof createChatModel>[0]) => {
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

  const handleUpdateModel = async (args: Parameters<typeof updateChatModel>[0]) => {
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
    modelCatalogResult,
    modelCatalog,
    isMutatingModels,
    handleCreateModel,
    handleUpdateModel,
    handleSetModelActiveState,
    handleImportTopFreeModels,
    handleImportTopPaidModels,
  };
}
