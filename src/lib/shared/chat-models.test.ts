import { describe, expect, it } from 'vitest';
import {
  chatModelSupportsWebSearch,
  DEFAULT_CHAT_MODEL_ID,
  getAuthorizedChatModel,
  getChatModelCatalogEntry,
  getChatModelOption,
  getDefaultChatModelCatalogEntry,
  selectActiveChatModelCatalogEntries,
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

  it('falls back to the first real selectable model before fabricating the curated default', () => {
    const options = [
      {
        id: 'openai/gpt-5-mini',
        label: 'GPT-5 Mini',
        description: 'Available model',
        access: 'public' as const,
        selectable: true,
      },
    ];

    expect(getChatModelOption(options, 'missing/model')).toEqual(options[0]);
  });
});

describe('getChatModelCatalogEntry', () => {
  it('returns the requested catalog model when present', () => {
    const searchableModel = {
      ...getDefaultChatModelCatalogEntry(),
      modelId: 'openai/gpt-4o-search-preview',
      label: 'GPT-4o Search',
      supportsWebSearch: true,
    };

    expect(getChatModelCatalogEntry([searchableModel], searchableModel.modelId)).toEqual(
      searchableModel,
    );
  });

  it('falls back to the curated default model when the requested model is unavailable', () => {
    const fallback = getChatModelCatalogEntry([], 'missing/model');

    expect(fallback).toMatchObject({
      modelId: DEFAULT_CHAT_MODEL_ID,
      supportsWebSearch: true,
    });
  });

  it('falls back to the first real catalog model before fabricating the curated default', () => {
    const availableModel = {
      ...getDefaultChatModelCatalogEntry(),
      modelId: 'openai/gpt-5-mini',
      label: 'GPT-5 Mini',
    };

    expect(getChatModelCatalogEntry([availableModel], 'missing/model')).toEqual(availableModel);
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

describe('chatModelSupportsWebSearch', () => {
  it('returns false when the catalog disables web search', () => {
    expect(chatModelSupportsWebSearch({ supportsWebSearch: false })).toBe(false);
  });

  it('defaults to true when support metadata is omitted', () => {
    expect(chatModelSupportsWebSearch({})).toBe(true);
  });
});

describe('selectActiveChatModelCatalogEntries', () => {
  it('keeps the curated default model available when catalog models omit it', () => {
    const activeModels = [
      {
        ...getDefaultChatModelCatalogEntry(),
        modelId: 'openai/gpt-5-mini',
        label: 'GPT-5 Mini',
      },
    ];

    expect(selectActiveChatModelCatalogEntries(activeModels).map((model) => model.modelId)).toEqual(
      expect.arrayContaining([DEFAULT_CHAT_MODEL_ID, 'openai/gpt-5-mini']),
    );
  });

  it('does not duplicate the curated default model when the catalog already includes it', () => {
    const activeModels = [
      getDefaultChatModelCatalogEntry(),
      {
        ...getDefaultChatModelCatalogEntry(),
        modelId: 'openai/gpt-5-mini',
        label: 'GPT-5 Mini',
      },
    ];

    expect(
      selectActiveChatModelCatalogEntries(activeModels).filter(
        (model) => model.modelId === DEFAULT_CHAT_MODEL_ID,
      ),
    ).toHaveLength(1);
  });
});
