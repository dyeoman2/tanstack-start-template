import { afterEach, describe, expect, it } from 'vitest';
import {
  assertChatModelSupportsWebSearch,
  classifyChatRunFailure,
  getOpenRouterProviderOptions,
} from './agentChat';

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalOpenRouterPrivacyMode = process.env.OPENROUTER_PRIVACY_MODE;

describe('getOpenRouterProviderOptions', () => {
  afterEach(() => {
    restoreEnv('OPENROUTER_API_KEY', originalOpenRouterApiKey);
    restoreEnv('OPENROUTER_PRIVACY_MODE', originalOpenRouterPrivacyMode);
  });

  it('omits strict provider routing in standard mode', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.OPENROUTER_PRIVACY_MODE;

    expect(
      getOpenRouterProviderOptions({
        modelId: 'openai/gpt-4o-mini',
        useWebSearch: false,
      }),
    ).toEqual({
      openrouter: {},
    });
  });

  it('includes strict provider routing in strict mode', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_PRIVACY_MODE = 'strict';

    expect(
      getOpenRouterProviderOptions({
        modelId: 'openai/gpt-4o-mini',
        useWebSearch: false,
      }),
    ).toEqual({
      openrouter: {
        provider: {
          zdr: true,
          data_collection: 'deny',
        },
      },
    });
  });
});

describe('classifyChatRunFailure', () => {
  it('classifies provider privacy errors', () => {
    expect(
      classifyChatRunFailure(
        new Error('No endpoints available matching your guardrail restrictions and data policy.'),
      ),
    ).toBe('provider_policy');
  });

  it('classifies provider availability errors', () => {
    expect(classifyChatRunFailure(new Error('No endpoints available for this request.'))).toBe(
      'provider_unavailable',
    );
  });

  it('classifies tool errors', () => {
    expect(classifyChatRunFailure(new Error('Tool execution failed during web_search.'))).toBe(
      'tool_error',
    );
  });

  it('falls back to unknown', () => {
    expect(classifyChatRunFailure(new Error('Something unexpected happened.'))).toBe('unknown');
  });
});

describe('assertChatModelSupportsWebSearch', () => {
  it('allows searchable models to use web search', () => {
    expect(() =>
      assertChatModelSupportsWebSearch({
        useWebSearch: true,
        model: { supportsWebSearch: true },
      }),
    ).not.toThrow();
  });

  it('rejects unsupported models when web search is requested', () => {
    expect(() =>
      assertChatModelSupportsWebSearch({
        useWebSearch: true,
        model: { supportsWebSearch: false },
      }),
    ).toThrow('Web search is not supported for the selected model.');
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
