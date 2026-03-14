'use node';

import { OpenRouter } from '@openrouter/sdk';
import { deriveIsSiteAdmin, normalizeUserRole } from '../src/features/auth/lib/user-role';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { authComponent } from './auth';
import { throwConvexError } from './auth/errors';
import { importedModelsResultValidator } from './lib/returnValidators';
import { getOpenRouterAttributionHeaders } from '../src/lib/server/openrouter';

const TOP_FREE_MODEL_IDS = [
  'stepfun/step-3.5-flash:free',
  'arcee-ai/trinity-large-preview:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'arcee-ai/trinity-mini:free',
] as const;

const TOP_PAID_MODEL_NAME_RANKING = [
  'MiniMax M2.5',
  'Gemini 3 Flash Preview',
  'DeepSeek V3.2',
  'Kimi K2.5',
  'Claude Opus 4.6',
] as const;

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function getOpenRouterClient() {
  return new OpenRouter({
    apiKey: getRequiredEnv('OPENROUTER_API_KEY'),
    ...(process.env.OPENROUTER_SITE_URL?.trim()
      ? { httpReferer: process.env.OPENROUTER_SITE_URL.trim() }
      : {}),
    ...(process.env.OPENROUTER_SITE_NAME?.trim()
      ? { xTitle: process.env.OPENROUTER_SITE_NAME.trim() }
      : {}),
  });
}

async function listZdrModelsForCurrentUser() {
  const client = getOpenRouterClient();
  const headers = getOpenRouterAttributionHeaders();

  return await client.models.listForUser(
    { bearer: getRequiredEnv('OPENROUTER_API_KEY') },
    {
      ...(headers?.['HTTP-Referer'] ? { httpReferer: headers['HTTP-Referer'] } : {}),
      ...(headers?.['X-Title'] ? { xTitle: headers['X-Title'] } : {}),
    },
  );
}

function dedupeByModelId<T extends { modelId: string }>(entries: T[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.modelId)) {
      return false;
    }

    seen.add(entry.modelId);
    return true;
  });
}

function formatImportedLabel(name: string) {
  const trimmed = name.trim();
  const separatorIndex = trimmed.indexOf(': ');

  if (separatorIndex === -1) {
    return trimmed;
  }

  return trimmed.slice(separatorIndex + 2);
}

function parsePrice(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPerMillionPrice(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  return value * 1_000_000;
}

function formatPerMillionPrice(value: number) {
  if (value === 0) {
    return '0';
  }

  if (value >= 1) {
    return value.toFixed(2).replace(/\.00$/, '');
  }

  if (value >= 0.01) {
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  return value.toPrecision(3);
}

function formatPriceLabel(promptPrice: number | undefined, completionPrice: number | undefined) {
  if (promptPrice === undefined && completionPrice === undefined) {
    return undefined;
  }

  if ((promptPrice ?? 0) === 0 && (completionPrice ?? 0) === 0) {
    return 'Free';
  }

  const parts = [];
  if (promptPrice !== undefined) {
    parts.push(`$${formatPerMillionPrice(promptPrice)}/M input`);
  }
  if (completionPrice !== undefined) {
    parts.push(`$${formatPerMillionPrice(completionPrice)}/M output`);
  }

  return parts.join(' | ');
}

async function requireSiteAdmin(ctx: ActionCtx) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throwConvexError('UNAUTHENTICATED', 'Not authenticated');
  }

  if (!deriveIsSiteAdmin(normalizeUserRole((authUser as { role?: string | string[] }).role))) {
    throwConvexError('ADMIN_REQUIRED', 'Site admin access required');
  }
}

export const importTopFreeModels = action({
  args: {},
  returns: importedModelsResultValidator,
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    await requireSiteAdmin(ctx);

    const response = await listZdrModelsForCurrentUser();
    const models = response.data.filter((model) => TOP_FREE_MODEL_IDS.includes(model.id as (typeof TOP_FREE_MODEL_IDS)[number]));

    if (models.length === 0) {
      throw new Error('OpenRouter did not return any of the configured top free models.');
    }

    const refreshedAt = Date.now();
    const entries = models.map((model) => {
      const promptPrice = toPerMillionPrice(parsePrice(model.pricing.prompt));
      const completionPrice = toPerMillionPrice(parsePrice(model.pricing.completion));

      return {
        modelId: model.id,
        label: formatImportedLabel(model.name),
        description:
          model.description?.trim() || 'Top free OpenRouter model imported from the current rankings.',
        task: 'Text Generation',
        access: 'public' as const,
        supportsWebSearch: true,
        priceLabel: formatPriceLabel(promptPrice, completionPrice),
        prices:
          promptPrice !== undefined || completionPrice !== undefined
            ? [
                ...(promptPrice !== undefined
                  ? [{ unit: 'per M input tokens', price: promptPrice, currency: 'USD' }]
                  : []),
                ...(completionPrice !== undefined
                  ? [{ unit: 'per M output tokens', price: completionPrice, currency: 'USD' }]
                  : []),
              ]
            : undefined,
        contextWindow: model.contextLength ?? undefined,
        source: 'openrouter',
        isActive: true,
        refreshedAt,
        deprecated: model.expirationDate !== undefined && model.expirationDate !== null,
        deprecationDate: model.expirationDate ?? undefined,
      };
    });

    const result: { modelCount: number } = await ctx.runMutation(internal.admin.upsertImportedChatModels, {
      entries,
      refreshedAt,
    });

    return {
      success: true,
      message: `Imported ${result.modelCount} top free OpenRouter models.`,
    };
  },
});

export const importTopPaidModels = action({
  args: {},
  returns: importedModelsResultValidator,
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    await requireSiteAdmin(ctx);

    const response = await listZdrModelsForCurrentUser();

    const rankedModels = dedupeByModelId(
      TOP_PAID_MODEL_NAME_RANKING.flatMap((name) => {
        const directMatch = response.data.find(
          (model) => model.name.trim().toLowerCase() === name.toLowerCase(),
        );

        if (directMatch) {
          return [directMatch];
        }

        const containsMatch = response.data.find((model) =>
          model.name.trim().toLowerCase().includes(name.toLowerCase()),
        );

        return containsMatch ? [containsMatch] : [];
      }).map((model) => {
        const promptPrice = toPerMillionPrice(parsePrice(model.pricing.prompt));
        const completionPrice = toPerMillionPrice(parsePrice(model.pricing.completion));

        return {
          modelId: model.id,
          label: formatImportedLabel(model.name),
          description:
            model.description?.trim() || 'Top paid OpenRouter model imported from the current rankings.',
          task: 'Text Generation',
          access: 'admin' as const,
          supportsWebSearch: true,
          priceLabel: formatPriceLabel(promptPrice, completionPrice),
          prices:
            promptPrice !== undefined || completionPrice !== undefined
              ? [
                  ...(promptPrice !== undefined
                    ? [{ unit: 'per M input tokens', price: promptPrice, currency: 'USD' }]
                    : []),
                  ...(completionPrice !== undefined
                    ? [{ unit: 'per M output tokens', price: completionPrice, currency: 'USD' }]
                    : []),
                ]
              : undefined,
          contextWindow: model.contextLength ?? undefined,
          source: 'openrouter',
          isActive: true,
          refreshedAt: Date.now(),
          deprecated: model.expirationDate !== undefined && model.expirationDate !== null,
          deprecationDate: model.expirationDate ?? undefined,
        };
      }),
    );

    if (rankedModels.length === 0) {
      throw new Error('OpenRouter did not return any of the configured top paid models.');
    }

    const refreshedAt = Date.now();
    const entries = rankedModels.map((entry) => ({
      ...entry,
      refreshedAt,
    }));

    const result: { modelCount: number } = await ctx.runMutation(internal.admin.upsertImportedChatModels, {
      entries,
      refreshedAt,
    });

    return {
      success: true,
      message: `Imported ${result.modelCount} top paid OpenRouter models.`,
    };
  },
});
