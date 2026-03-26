import { v } from 'convex/values';
import {
  type ChatModelCatalogEntry,
  type ChatModelOption,
  selectActiveChatModelCatalogEntries,
  toChatModelOption,
} from '../src/lib/shared/chat-models';
import { internal } from './_generated/api';
import type { QueryCtx } from './_generated/server';
import { internalQuery, query } from './_generated/server';
import { getCurrentUserOrNull } from './auth/access';
import { aiModelCatalogEntryValidator, chatModelOptionValidator } from './lib/returnValidators';

function sortModels<
  T extends {
    access: 'public' | 'admin';
    label: string;
    modelId?: string;
    id?: string;
  },
>(models: T[]) {
  return [...models].sort((left, right) => {
    if (left.access !== right.access) {
      return left.access === 'public' ? -1 : 1;
    }

    return left.label.localeCompare(right.label);
  });
}

type CatalogEntrySource = {
  access: 'public' | 'admin';
  beta?: boolean;
  contextWindow?: number;
  deprecated?: boolean;
  deprecationDate?: string;
  description: string;
  isActive: boolean;
  label: string;
  modelId: string;
  priceLabel?: string;
  prices?: ChatModelCatalogEntry['prices'];
  refreshedAt: number;
  source: string;
  supportsWebSearch?: boolean;
  task: string;
};

function toCatalogEntry(model: CatalogEntrySource): ChatModelCatalogEntry {
  return {
    access: model.access,
    ...(model.beta !== undefined ? { beta: model.beta } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.deprecated !== undefined ? { deprecated: model.deprecated } : {}),
    ...(model.deprecationDate !== undefined ? { deprecationDate: model.deprecationDate } : {}),
    description: model.description,
    isActive: model.isActive,
    label: model.label,
    modelId: model.modelId,
    ...(model.priceLabel !== undefined ? { priceLabel: model.priceLabel } : {}),
    ...(model.prices !== undefined ? { prices: model.prices } : {}),
    refreshedAt: model.refreshedAt,
    source: model.source,
    ...(model.supportsWebSearch !== undefined
      ? { supportsWebSearch: model.supportsWebSearch }
      : {}),
    task: model.task,
  };
}

export function filterVisibleModels(
  models: ChatModelCatalogEntry[],
  isSiteAdmin: boolean,
): ChatModelCatalogEntry[] {
  if (isSiteAdmin) {
    return models;
  }

  return models.filter((model) => model.access === 'public');
}

async function getActiveCatalogModels(ctx: QueryCtx) {
  const activeModels = await ctx.db
    .query('aiModelCatalog')
    .withIndex('by_isActive', (q) => q.eq('isActive', true))
    .collect();

  return sortModels(selectActiveChatModelCatalogEntries(activeModels.map(toCatalogEntry)));
}

export const listActiveChatModelsInternal = internalQuery({
  args: {},
  returns: v.array(aiModelCatalogEntryValidator),
  handler: async (ctx): Promise<ChatModelCatalogEntry[]> => {
    return await getActiveCatalogModels(ctx);
  },
});

export const listAvailableChatModels = query({
  args: {},
  returns: v.array(chatModelOptionValidator),
  handler: async (ctx): Promise<ChatModelOption[]> => {
    const user = await getCurrentUserOrNull(ctx);
    const isSiteAdmin = user?.isSiteAdmin === true;
    const activeModels: ChatModelCatalogEntry[] = await ctx.runQuery(
      internal.chatModels.listActiveChatModelsInternal,
      {},
    );
    const visibleModels = filterVisibleModels(activeModels, isSiteAdmin);

    return sortModels(
      visibleModels.map((model: ChatModelCatalogEntry) => toChatModelOption(model, isSiteAdmin)),
    );
  },
});
