import { afterEach, describe, expect, it } from 'vitest';
import { getOpenRouterConfig } from './openrouter';

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalOpenRouterSiteUrl = process.env.OPENROUTER_SITE_URL;
const originalOpenRouterSiteName = process.env.OPENROUTER_SITE_NAME;

describe('getOpenRouterConfig', () => {
  afterEach(() => {
    restoreEnv('OPENROUTER_API_KEY', originalOpenRouterApiKey);
    restoreEnv('OPENROUTER_SITE_URL', originalOpenRouterSiteUrl);
    restoreEnv('OPENROUTER_SITE_NAME', originalOpenRouterSiteName);
  });

  it('throws when the API key is missing', () => {
    delete process.env.OPENROUTER_API_KEY;

    expect(() => getOpenRouterConfig()).toThrowError(
      'OPENROUTER_API_KEY environment variable is required',
    );
  });

  it('builds the provider config with OpenRouter headers', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_SITE_URL = 'https://example.com';
    process.env.OPENROUTER_SITE_NAME = 'Example App';

    expect(getOpenRouterConfig()).toEqual({
      apiKey: 'test-key',
      headers: {
        'HTTP-Referer': 'https://example.com',
        'X-Title': 'Example App',
      },
      compatibility: 'strict',
    });
  });

  it('omits attribution headers when they are not configured', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.OPENROUTER_SITE_URL;
    delete process.env.OPENROUTER_SITE_NAME;

    expect(getOpenRouterConfig()).toEqual({
      apiKey: 'test-key',
      compatibility: 'strict',
    });
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
