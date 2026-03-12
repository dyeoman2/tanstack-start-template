import { describe, expect, it } from 'vitest';
import { normalizeCloudflareTextGenerationModels } from '~/lib/shared/cloudflare-model-catalog';
import {
  DEFAULT_CHAT_MODEL_ID,
  getAuthorizedChatModel,
  getDefaultChatModelCatalogEntry,
} from '~/lib/shared/chat-models';

describe('normalizeCloudflareTextGenerationModels', () => {
  it('keeps the free public model and explicitly priced Cloudflare text-generation models', () => {
    const refreshedAt = 123;
    const models = normalizeCloudflareTextGenerationModels(
      [
        {
          name: DEFAULT_CHAT_MODEL_ID,
          description: 'Free default model',
          task: { name: 'Text Generation' },
          properties: [
            { property_id: 'price', value: [{ unit: 'per M input tokens', price: 0, currency: 'USD' }] },
          ],
          source: 1,
        },
        {
          name: '@cf/openai/gpt-oss-120b',
          description: 'Paid admin model',
          task: { name: 'Text Generation' },
          properties: [
            {
              property_id: 'price',
              value: [
                { unit: 'per M input tokens', price: 0.35, currency: 'USD' },
                { unit: 'per M output tokens', price: 0.75, currency: 'USD' },
              ],
            },
          ],
          source: 1,
        },
        {
          name: '@cf/qwen/qwen1.5-0.5b-chat',
          description: 'Unknown price model',
          task: { name: 'Text Generation' },
          properties: [{ property_id: 'beta', value: 'true' }],
          source: 1,
        },
        {
          name: '@cf/black-forest-labs/flux-1-schnell',
          description: 'Image model',
          task: { name: 'Text-to-Image' },
          properties: [
            { property_id: 'price', value: [{ unit: 'per step', price: 0.001, currency: 'USD' }] },
          ],
          source: 1,
        },
        {
          name: '@hf/some/model',
          description: 'Non Cloudflare model',
          task: { name: 'Text Generation' },
          properties: [
            { property_id: 'price', value: [{ unit: 'per step', price: 0.001, currency: 'USD' }] },
          ],
          source: 2,
        },
      ],
      refreshedAt,
    );

    expect(models.map((model) => model.modelId)).toEqual([
      DEFAULT_CHAT_MODEL_ID,
      '@cf/openai/gpt-oss-120b',
    ]);
    expect(models[0]).toMatchObject({
      access: 'public',
      refreshedAt,
      priceLabel: 'Free',
    });
    expect(models[1]).toMatchObject({
      access: 'admin',
      refreshedAt,
    });
  });
});

describe('getAuthorizedChatModel', () => {
  const publicModel = getDefaultChatModelCatalogEntry();
  const adminModel = {
    ...getDefaultChatModelCatalogEntry(),
    modelId: '@cf/openai/gpt-oss-120b',
    label: 'GPT OSS 120B',
    access: 'admin' as const,
    priceLabel: '$0.35/per M input tokens',
  };

  it('allows the public model for non-admin users', () => {
    expect(getAuthorizedChatModel(publicModel.modelId, [publicModel, adminModel], false)).toEqual({
      ok: true,
      model: publicModel,
    });
  });

  it('blocks admin-only models for non-admin users', () => {
    expect(getAuthorizedChatModel(adminModel.modelId, [publicModel, adminModel], false)).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('allows admin-only models for site admins', () => {
    expect(getAuthorizedChatModel(adminModel.modelId, [publicModel, adminModel], true)).toEqual({
      ok: true,
      model: adminModel,
    });
  });

  it('rejects unknown models', () => {
    expect(getAuthorizedChatModel('@cf/unknown/model', [publicModel, adminModel], true)).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});
