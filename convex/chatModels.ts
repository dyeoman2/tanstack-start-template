import { internal } from './_generated/api';
import type { QueryCtx } from './_generated/server';
import { internalQuery, query } from './_generated/server';
import { getCurrentUserOrNull } from './auth/access';
import {
  selectActiveChatModelCatalogEntries,
  type ChatModelCatalogEntry,
  type ChatModelOption,
  toChatModelOption,
} from '../src/lib/shared/chat-models';

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

async function getActiveCatalogModels(ctx: QueryCtx) {
  const activeModels = await ctx.db
    .query('aiModelCatalog')
    .withIndex('by_isActive', (q) => q.eq('isActive', true))
    .collect();

  return sortModels(selectActiveChatModelCatalogEntries(activeModels));
}

export const listActiveChatModelsInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<ChatModelCatalogEntry[]> => {
    return await getActiveCatalogModels(ctx);
  },
});

export const listAvailableChatModels = query({
  args: {},
  handler: async (ctx): Promise<ChatModelOption[]> => {
    const user = await getCurrentUserOrNull(ctx);
    const isSiteAdmin = user?.isSiteAdmin === true;
    const activeModels: ChatModelCatalogEntry[] = await ctx.runQuery(
      internal.chatModels.listActiveChatModelsInternal,
      {},
    );

    return sortModels(activeModels.map((model: ChatModelCatalogEntry) => toChatModelOption(model, isSiteAdmin)));
  },
});
