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
  priceLabel?: string;
  badge?: string;
};

export const DEFAULT_CHAT_MODEL_ID = '@cf/nvidia/nemotron-3-120b-a12b';
export const DEFAULT_CHAT_MODEL_LABEL = 'Nemotron 3 120B';
export const DEFAULT_CHAT_MODEL_DESCRIPTION =
  'Free Cloudflare text-generation model for everyday chat.';

export function getDefaultChatModelCatalogEntry(refreshedAt: number = 0): ChatModelCatalogEntry {
  return {
    modelId: DEFAULT_CHAT_MODEL_ID,
    label: DEFAULT_CHAT_MODEL_LABEL,
    description: DEFAULT_CHAT_MODEL_DESCRIPTION,
    task: 'Text Generation',
    access: 'public',
    priceLabel: 'Free',
    prices: [
      { unit: 'per M input tokens', price: 0, currency: 'USD' },
      { unit: 'per M output tokens', price: 0, currency: 'USD' },
    ],
    source: 'cloudflare',
    isActive: true,
    refreshedAt,
  };
}

export function isPublicChatModel(modelId: string): boolean {
  return modelId === DEFAULT_CHAT_MODEL_ID;
}

export function formatChatModelLabel(modelId: string): string {
  if (modelId === DEFAULT_CHAT_MODEL_ID) {
    return DEFAULT_CHAT_MODEL_LABEL;
  }

  const baseName = modelId.split('/').pop() ?? modelId;
  return baseName
    .split('-')
    .map((part) => part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function isChatModelSelectable(
  access: ChatModelAccess,
  isSiteAdmin: boolean,
): boolean {
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
    priceLabel: model.priceLabel,
    badge:
      model.access === 'admin'
        ? 'Admin only'
        : model.priceLabel === 'Free'
          ? 'Free'
          : undefined,
  };
}

export function getChatModelOption(
  models: ChatModelOption[],
  modelId?: string,
): ChatModelOption {
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

  return toChatModelOption(getDefaultChatModelCatalogEntry(), true);
}

export function isChatModelKnown(
  modelId: string,
  models: ChatModelCatalogEntry[],
): boolean {
  return models.some((model) => model.modelId === modelId);
}

export function getAuthorizedChatModel(
  modelId: string,
  models: ChatModelCatalogEntry[],
  isSiteAdmin: boolean,
):
  | { ok: true; model: ChatModelCatalogEntry }
  | { ok: false; reason: 'unknown' | 'forbidden' } {
  const matchedModel = models.find((model) => model.modelId === modelId);
  if (!matchedModel) {
    return { ok: false, reason: 'unknown' };
  }

  if (!isChatModelSelectable(matchedModel.access, isSiteAdmin)) {
    return { ok: false, reason: 'forbidden' };
  }

  return { ok: true, model: matchedModel };
}
