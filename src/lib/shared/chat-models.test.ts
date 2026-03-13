import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAT_MODEL_ID,
  getChatModelOption,
  getAuthorizedChatModel,
  getDefaultChatModelCatalogEntry,
  toChatModelOption,
} from '~/lib/shared/chat-models';

describe('getDefaultChatModelCatalogEntry', () => {
  it('returns the curated OpenRouter default model', () => {
    expect(getDefaultChatModelCatalogEntry(123)).toMatchObject({
      modelId: DEFAULT_CHAT_MODEL_ID,
      label: 'GPT-4o Mini',
      source: 'openrouter',
      supportsWebSearch: true,
      refreshedAt: 123,
    });
  });
});

describe('getAuthorizedChatModel', () => {
  const publicModel = getDefaultChatModelCatalogEntry();
  const adminModel = {
    ...getDefaultChatModelCatalogEntry(),
    modelId: 'anthropic/claude-3.5-sonnet',
    label: 'Claude 3.5 Sonnet',
    access: 'admin' as const,
    priceLabel: '$3/M input tokens',
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
    expect(getAuthorizedChatModel('unknown/model', [publicModel, adminModel], true)).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});

describe('getChatModelOption', () => {
  it('falls back to the default model when the requested model is unavailable', () => {
    const options = [
      {
        id: DEFAULT_CHAT_MODEL_ID,
        label: 'GPT-4o Mini',
        description: 'Default',
        access: 'public' as const,
        selectable: true,
      },
    ];

    expect(getChatModelOption(options, 'missing/model')).toEqual(options[0]);
  });
});

describe('toChatModelOption', () => {
  it('preserves web search support on searchable models', () => {
    const model = {
      ...getDefaultChatModelCatalogEntry(),
      supportsWebSearch: true,
    };

    expect(toChatModelOption(model, true)).toMatchObject({
      id: model.modelId,
      supportsWebSearch: true,
    });
  });
});
