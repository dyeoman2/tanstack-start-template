import { afterEach, describe, expect, it } from 'vitest';
import { getOpenRouterConfig } from './openrouter';

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;
const originalAppName = process.env.APP_NAME;
const originalOpenRouterPrivacyMode = process.env.OPENROUTER_PRIVACY_MODE;

describe('getOpenRouterConfig', () => {
  afterEach(() => {
    restoreEnv('OPENROUTER_API_KEY', originalOpenRouterApiKey);
    restoreEnv('BETTER_AUTH_URL', originalBetterAuthUrl);
    restoreEnv('APP_NAME', originalAppName);
    restoreEnv('OPENROUTER_PRIVACY_MODE', originalOpenRouterPrivacyMode);
  });

  it('throws when the API key is missing', () => {
    delete process.env.OPENROUTER_API_KEY;

    expect(() => getOpenRouterConfig()).toThrowError(
      'OPENROUTER_API_KEY environment variable is required',
    );
  });

  it('builds the provider config with OpenRouter headers and strict privacy mode by default', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.BETTER_AUTH_URL = 'https://example.com';
    process.env.APP_NAME = 'Example App';
    delete process.env.OPENROUTER_PRIVACY_MODE;

    expect(getOpenRouterConfig()).toEqual({
      apiKey: 'test-key',
      headers: {
        'HTTP-Referer': 'https://example.com',
        'X-Title': 'Example App',
      },
      compatibility: 'strict',
      privacyMode: 'strict',
    });
  });

  it('omits attribution headers when they are not configured', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.BETTER_AUTH_URL;
    delete process.env.APP_NAME;
    delete process.env.OPENROUTER_PRIVACY_MODE;

    expect(getOpenRouterConfig()).toEqual({
      apiKey: 'test-key',
      compatibility: 'strict',
      privacyMode: 'strict',
    });
  });

  it('accepts explicit strict privacy mode', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_PRIVACY_MODE = 'strict';

    expect(getOpenRouterConfig()).toEqual({
      apiKey: 'test-key',
      compatibility: 'strict',
      privacyMode: 'strict',
    });
  });

  it('throws when privacy mode is set to standard', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_PRIVACY_MODE = 'standard';

    expect(() => getOpenRouterConfig()).toThrowError('OPENROUTER_PRIVACY_MODE must be "strict"');
  });

  it('throws when the privacy mode is invalid', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_PRIVACY_MODE = 'invalid';

    expect(() => getOpenRouterConfig()).toThrowError('OPENROUTER_PRIVACY_MODE must be "strict"');
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
