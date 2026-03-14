export type ChatModelId = string;
export type ChatModelAccess = 'public' | 'admin';

export type ChatModelPrice = {
  unit: string;
  price: number;
  currency: string;
};

export type ChatModelCatalogEntry = {
  modelId: ChatModelId;
  label: string;
  description: string;
  task: string;
  access: ChatModelAccess;
  supportsWebSearch?: boolean;
  priceLabel?: string;
  prices?: ChatModelPrice[];
  contextWindow?: number;
  source: string;
  isActive: boolean;
  refreshedAt: number;
  beta?: boolean;
  deprecated?: boolean;
  deprecationDate?: string;
};

export type ChatModelOption = {
  id: ChatModelId;
  label: string;
  description: string;
  access: ChatModelAccess;
  selectable: boolean;
  supportsWebSearch?: boolean;
  priceLabel?: string;
  badge?: string;
};

export const DEFAULT_CHAT_MODEL_ID = 'openai/gpt-4o-mini';
const DEFAULT_CHAT_MODEL_LABEL = 'GPT-4o Mini';
const DEFAULT_CHAT_MODEL_DESCRIPTION = 'Fast OpenRouter text-generation model for everyday chat.';

type ChatModelWithWebSearch = {
  supportsWebSearch?: boolean;
};

export function getDefaultChatModelCatalogEntry(refreshedAt: number = 0): ChatModelCatalogEntry {
  return {
    modelId: DEFAULT_CHAT_MODEL_ID,
    label: DEFAULT_CHAT_MODEL_LABEL,
    description: DEFAULT_CHAT_MODEL_DESCRIPTION,
    task: 'Text Generation',
    access: 'public',
    supportsWebSearch: true,
    priceLabel: 'Free',
    prices: [
      { unit: 'per M input tokens', price: 0.15, currency: 'USD' },
      { unit: 'per M output tokens', price: 0.6, currency: 'USD' },
    ],
    source: 'openrouter',
    isActive: true,
    refreshedAt,
  };
}

export function chatModelSupportsWebSearch(model?: ChatModelWithWebSearch | null): boolean {
  return model?.supportsWebSearch ?? true;
}

export function selectActiveChatModelCatalogEntries(models: ChatModelCatalogEntry[]) {
  const openRouterModels = models.filter((model) => model.source === 'openrouter');

  if (openRouterModels.some((model) => model.modelId === DEFAULT_CHAT_MODEL_ID)) {
    return openRouterModels;
  }

  return [...openRouterModels, getDefaultChatModelCatalogEntry()];
}

function isChatModelSelectable(access: ChatModelAccess, isSiteAdmin: boolean): boolean {
  return access === 'public' || isSiteAdmin;
}

export function toChatModelOption(
  model: ChatModelCatalogEntry,
  isSiteAdmin: boolean,
): ChatModelOption {
  const selectable = isChatModelSelectable(model.access, isSiteAdmin);

  return {
    id: model.modelId,
    label: model.label,
    description: model.description,
    access: model.access,
    selectable,
    supportsWebSearch: chatModelSupportsWebSearch(model),
    priceLabel: model.priceLabel,
    badge:
      model.access === 'admin' ? 'Admin only' : model.priceLabel === 'Free' ? 'Free' : undefined,
  };
}

export function getChatModelOption(models: ChatModelOption[], modelId?: string): ChatModelOption {
  if (modelId) {
    const matchedModel = models.find((model) => model.id === modelId);
    if (matchedModel) {
      return matchedModel;
    }
  }

  const defaultModel = models.find((model) => model.id === DEFAULT_CHAT_MODEL_ID);
  if (defaultModel) {
    return defaultModel;
  }

  const firstSelectableModel = models.find((model) => model.selectable);
  if (firstSelectableModel) {
    return firstSelectableModel;
  }

  const firstModel = models[0];
  if (firstModel) {
    return firstModel;
  }

  return toChatModelOption(getDefaultChatModelCatalogEntry(), true);
}

export function getChatModelCatalogEntry(
  models: ChatModelCatalogEntry[],
  modelId?: string,
): ChatModelCatalogEntry {
  if (modelId) {
    const matchedModel = models.find((model) => model.modelId === modelId);
    if (matchedModel) {
      return matchedModel;
    }
  }

  const defaultModel = models.find((model) => model.modelId === DEFAULT_CHAT_MODEL_ID);
  if (defaultModel) {
    return defaultModel;
  }

  const firstModel = models[0];
  if (firstModel) {
    return firstModel;
  }

  return getDefaultChatModelCatalogEntry();
}

export function getAuthorizedChatModel(
  modelId: string,
  models: ChatModelCatalogEntry[],
  isSiteAdmin: boolean,
): { ok: true; model: ChatModelCatalogEntry } | { ok: false; reason: 'unknown' | 'forbidden' } {
  const matchedModel = models.find((model) => model.modelId === modelId);
  if (!matchedModel) {
    return { ok: false, reason: 'unknown' };
  }

  if (!isChatModelSelectable(matchedModel.access, isSiteAdmin)) {
    return { ok: false, reason: 'forbidden' };
  }

  return { ok: true, model: matchedModel };
}
