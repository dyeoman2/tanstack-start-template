import { describe, expect, it } from 'vitest';
import {
  getOpenRouterWebSearchPlugin,
  getOpenRouterWebSearchProviderOptions,
  isAnthropicChatModel,
  OPENROUTER_WEB_SEARCH_PLUGIN,
  type OpenRouterWebSearchSource,
  shouldUseOpenRouterWebSearch,
  toSourceUrlParts,
} from '~/features/chat/lib/openrouter-web-search';

describe('OPENROUTER_WEB_SEARCH_PLUGIN', () => {
  it('uses the configured web plugin defaults', () => {
    expect(OPENROUTER_WEB_SEARCH_PLUGIN).toEqual({
      id: 'web',
    });
  });
});

describe('Anthropic web search policy', () => {
  it('detects Anthropic chat models', () => {
    expect(isAnthropicChatModel('anthropic/claude-opus-4.1')).toBe(true);
    expect(isAnthropicChatModel('openai/gpt-5')).toBe(false);
  });

  it('allows OpenRouter web search for Anthropic models', () => {
    expect(shouldUseOpenRouterWebSearch('anthropic/claude-opus-4.1')).toBe(true);
    expect(shouldUseOpenRouterWebSearch('openai/gpt-5')).toBe(true);
  });

  it('keeps the plain web plugin for searchable models', () => {
    expect(getOpenRouterWebSearchPlugin('anthropic/claude-opus-4.1')).toEqual(
      OPENROUTER_WEB_SEARCH_PLUGIN,
    );
    expect(getOpenRouterWebSearchPlugin('openai/gpt-5')).toEqual(OPENROUTER_WEB_SEARCH_PLUGIN);
  });

  it('does not add special provider options', () => {
    expect(getOpenRouterWebSearchProviderOptions('anthropic/claude-opus-4.1')).toBeUndefined();
    expect(getOpenRouterWebSearchProviderOptions('openai/gpt-5')).toBeUndefined();
  });
});

describe('toSourceUrlParts', () => {
  it('converts URL sources into source-url parts', () => {
    const sources: OpenRouterWebSearchSource[] = [
      {
        sourceType: 'url',
        id: 'source-1',
        url: 'https://example.com',
        title: 'Example',
      },
    ];

    expect(toSourceUrlParts(sources)).toEqual([
      {
        type: 'source-url',
        sourceId: 'source-1',
        url: 'https://example.com',
        title: 'Example',
      },
    ]);
  });

  it('deduplicates URL sources by URL', () => {
    const sources: OpenRouterWebSearchSource[] = [
      {
        sourceType: 'url',
        id: 'source-1',
        url: 'https://example.com',
        title: 'First',
      },
      {
        sourceType: 'url',
        id: 'source-2',
        url: 'https://example.com',
        title: 'Second',
      },
    ];

    expect(toSourceUrlParts(sources)).toEqual([
      {
        type: 'source-url',
        sourceId: 'source-1',
        url: 'https://example.com',
        title: 'First',
      },
    ]);
  });
});
