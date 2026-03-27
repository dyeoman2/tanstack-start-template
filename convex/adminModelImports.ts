'use node';

import { OpenRouter } from '@openrouter/sdk';
import { getOpenRouterConfig } from '../src/lib/server/openrouter';
import { type VendorDataClass, type VendorKey } from '../src/lib/server/vendor-boundary.server';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { internalAction } from './_generated/server';
import { siteAdminAction } from './auth/authorized';
import { recordSiteAdminAuditEvent } from './lib/auditEmitters';
import { importedModelsResultValidator } from './lib/returnValidators';
import { executeVendorOperation, type VendorAuditTarget } from './lib/vendorAudit';

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

const MODEL_IMPORT_VENDOR: VendorKey = 'openrouter';
const MODEL_IMPORT_DATA_CLASSES: VendorDataClass[] = ['chat_metadata'];

type ModelImportAuditTarget =
  | {
      actorUserId: string;
      emitter: string;
      kind: 'site_admin';
      sourceSurface: string;
    }
  | {
      emitter: string;
      initiatedByUserId?: string;
      kind: 'system';
      sourceSurface: string;
    };

function toModelImportVendorAuditTarget(audit: ModelImportAuditTarget): VendorAuditTarget {
  if (audit.kind === 'site_admin') {
    return {
      actorUserId: audit.actorUserId,
      emitter: audit.emitter,
      kind: 'site_admin',
      sourceSurface: audit.sourceSurface,
      userId: audit.actorUserId,
    };
  }

  return {
    emitter: audit.emitter,
    initiatedByUserId: audit.initiatedByUserId,
    kind: 'system',
    sourceSurface: audit.sourceSurface,
    userId: audit.initiatedByUserId,
  };
}

/**
 * Creates an OpenRouter SDK client sourced through the shared vendor boundary.
 * This ensures `assertVendorBoundary()` runs before any outbound OpenRouter request.
 */
function getOpenRouterSdkClient() {
  const config = getOpenRouterConfig();

  return new OpenRouter({
    apiKey: config.apiKey,
    ...(config.headers?.['HTTP-Referer'] ? { httpReferer: config.headers['HTTP-Referer'] } : {}),
    ...(config.headers?.['X-Title'] ? { xTitle: config.headers['X-Title'] } : {}),
  });
}

async function listZdrModelsForCurrentUser(
  ctx: ActionCtx,
  audit: ModelImportAuditTarget,
  context: Record<string, boolean | number | string | null>,
) {
  return await executeVendorOperation(ctx, toModelImportVendorAuditTarget(audit), {
    context,
    dataClasses: MODEL_IMPORT_DATA_CLASSES,
    operation: 'model_catalog_import',
    vendor: MODEL_IMPORT_VENDOR,
    execute: async () => {
      const config = getOpenRouterConfig();
      const client = getOpenRouterSdkClient();
      return await client.models.listForUser(
        { bearer: config.apiKey },
        {
          ...(config.headers?.['HTTP-Referer']
            ? { httpReferer: config.headers['HTTP-Referer'] }
            : {}),
          ...(config.headers?.['X-Title'] ? { xTitle: config.headers['X-Title'] } : {}),
        },
      );
    },
  });
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

async function importTopFreeModelsInternal(
  ctx: ActionCtx,
  audit: ModelImportAuditTarget,
): Promise<{ success: boolean; message: string }> {
  const response = await listZdrModelsForCurrentUser(ctx, audit, {
    catalogType: 'free',
  });
  const models = response.data.filter((model) =>
    TOP_FREE_MODEL_IDS.includes(model.id as (typeof TOP_FREE_MODEL_IDS)[number]),
  );

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
        model.description?.trim() ||
        'Top free OpenRouter model imported from the current rankings.',
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

  const result: { modelCount: number } = await ctx.runMutation(
    internal.admin.upsertImportedChatModels,
    {
      entries,
      refreshedAt,
    },
  );

  return {
    success: true,
    message: `Imported ${result.modelCount} top free OpenRouter models.`,
  };
}

async function importTopPaidModelsInternal(
  ctx: ActionCtx,
  audit: ModelImportAuditTarget,
): Promise<{ success: boolean; message: string }> {
  const response = await listZdrModelsForCurrentUser(ctx, audit, {
    catalogType: 'paid',
  });

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
          model.description?.trim() ||
          'Top paid OpenRouter model imported from the current rankings.',
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

  const result: { modelCount: number } = await ctx.runMutation(
    internal.admin.upsertImportedChatModels,
    {
      entries,
      refreshedAt,
    },
  );

  return {
    success: true,
    message: `Imported ${result.modelCount} top paid OpenRouter models.`,
  };
}

export const importTopFreeModels = siteAdminAction({
  args: {},
  returns: importedModelsResultValidator,
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    const result = await importTopFreeModelsInternal(ctx, {
      kind: 'site_admin',
      actorUserId: ctx.user.authUserId,
      emitter: 'adminModelImports.importTopFreeModels',
      sourceSurface: 'admin_model_imports',
    });

    await recordSiteAdminAuditEvent(ctx, {
      actorUserId: ctx.user.authUserId,
      emitter: 'adminModelImports.importTopFreeModels',
      eventType: 'ai_model_catalog_imported',
      outcome: 'success',
      severity: 'info',
      sourceSurface: 'admin_model_imports',
      resourceType: 'ai_model_catalog',
      metadata: JSON.stringify({
        catalogType: 'free',
        modelCount: result.message.match(/\d+/)?.[0] ?? 'unknown',
        source: 'openrouter',
      }),
    });

    return result;
  },
});

export const importTopFreeModelsForSetup = internalAction({
  args: {},
  returns: importedModelsResultValidator,
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    return await importTopFreeModelsInternal(ctx, {
      kind: 'system',
      emitter: 'adminModelImports.importTopFreeModelsForSetup',
      sourceSurface: 'admin_model_imports.setup',
    });
  },
});

export const importTopPaidModels = siteAdminAction({
  args: {},
  returns: importedModelsResultValidator,
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    const result = await importTopPaidModelsInternal(ctx, {
      kind: 'site_admin',
      actorUserId: ctx.user.authUserId,
      emitter: 'adminModelImports.importTopPaidModels',
      sourceSurface: 'admin_model_imports',
    });

    await recordSiteAdminAuditEvent(ctx, {
      actorUserId: ctx.user.authUserId,
      emitter: 'adminModelImports.importTopPaidModels',
      eventType: 'ai_model_catalog_imported',
      outcome: 'success',
      severity: 'info',
      sourceSurface: 'admin_model_imports',
      resourceType: 'ai_model_catalog',
      metadata: JSON.stringify({
        catalogType: 'paid',
        modelCount: result.message.match(/\d+/)?.[0] ?? 'unknown',
        source: 'openrouter',
      }),
    });

    return result;
  },
});

export const importTopPaidModelsForSetup = internalAction({
  args: {},
  returns: importedModelsResultValidator,
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    return await importTopPaidModelsInternal(ctx, {
      kind: 'system',
      emitter: 'adminModelImports.importTopPaidModelsForSetup',
      sourceSurface: 'admin_model_imports.setup',
    });
  },
});
