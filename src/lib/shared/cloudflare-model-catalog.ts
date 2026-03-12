import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_CHAT_MODEL_LABEL,
  formatChatModelLabel,
  type ChatModelCatalogEntry,
  type ChatModelPrice,
} from './chat-models';

type CloudflareTask = {
  name?: string;
};

type CloudflareProperty = {
  property_id?: string;
  value?: unknown;
};

export type CloudflareCatalogModel = {
  name?: string;
  description?: string;
  source?: number;
  task?: CloudflareTask;
  properties?: CloudflareProperty[];
};

function getProperty(entry: CloudflareCatalogModel, propertyId: string): unknown {
  return entry.properties?.find((property) => property.property_id === propertyId)?.value;
}

function getBooleanProperty(entry: CloudflareCatalogModel, propertyId: string): boolean | undefined {
  const value = getProperty(entry, propertyId);
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function getStringProperty(entry: CloudflareCatalogModel, propertyId: string): string | undefined {
  const value = getProperty(entry, propertyId);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNumberProperty(entry: CloudflareCatalogModel, propertyId: string): number | undefined {
  const value = getProperty(entry, propertyId);
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getCloudflareModelPrices(entry: CloudflareCatalogModel): ChatModelPrice[] {
  const value = getProperty(entry, 'price');
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((priceEntry) => {
    if (!priceEntry || typeof priceEntry !== 'object') {
      return [];
    }

    const candidate = priceEntry as Record<string, unknown>;
    const unit = typeof candidate.unit === 'string' ? candidate.unit : null;
    const currency = typeof candidate.currency === 'string' ? candidate.currency : null;
    const price =
      typeof candidate.price === 'number'
        ? candidate.price
        : typeof candidate.price === 'string'
          ? Number(candidate.price)
          : NaN;

    if (!unit || !currency || !Number.isFinite(price)) {
      return [];
    }

    return [{ unit, currency, price }];
  });
}

function formatCloudflarePriceLabel(prices: ChatModelPrice[]): string | undefined {
  if (prices.length === 0) {
    return undefined;
  }

  if (prices.every((price) => price.price === 0)) {
    return 'Free';
  }

  return prices
    .map((price) => `$${price.price}/${price.unit}`)
    .join(' | ');
}

export function normalizeCloudflareTextGenerationModels(
  entries: CloudflareCatalogModel[],
  refreshedAt: number,
): ChatModelCatalogEntry[] {
  return entries.flatMap((entry) => {
    const modelId = typeof entry.name === 'string' ? entry.name : null;
    if (!modelId || !modelId.startsWith('@cf/')) {
      return [];
    }

    if (entry.task?.name !== 'Text Generation') {
      return [];
    }

    const prices = getCloudflareModelPrices(entry);
    const isPublicModel = modelId === DEFAULT_CHAT_MODEL_ID;
    if (prices.length === 0 && !isPublicModel) {
      return [];
    }

    return [
      {
        modelId,
        label: modelId === DEFAULT_CHAT_MODEL_ID ? DEFAULT_CHAT_MODEL_LABEL : formatChatModelLabel(modelId),
        description:
          typeof entry.description === 'string' && entry.description.length > 0
            ? entry.description
            : 'Cloudflare Workers AI text-generation model.',
        task: 'Text Generation',
        access: isPublicModel ? 'public' : 'admin',
        priceLabel: formatCloudflarePriceLabel(prices),
        prices,
        contextWindow: getNumberProperty(entry, 'context_window'),
        source: entry.source === 1 ? 'cloudflare' : 'catalog',
        isActive: true,
        refreshedAt,
        beta: getBooleanProperty(entry, 'beta'),
        deprecated: getStringProperty(entry, 'planned_deprecation_date') !== undefined,
        deprecationDate: getStringProperty(entry, 'planned_deprecation_date'),
      },
    ];
  });
}
