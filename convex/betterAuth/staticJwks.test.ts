import { beforeEach, describe, expect, it } from 'vitest';

import { resolveAuthConfigProvider, resolveBetterAuthPluginJwks } from './staticJwks';

function isCustomJwtProvider(
  value: ReturnType<typeof resolveAuthConfigProvider>,
): value is Extract<ReturnType<typeof resolveAuthConfigProvider>, { type: 'customJwt' }> {
  return 'type' in value && value.type === 'customJwt';
}

describe('static JWKS normalization', () => {
  beforeEach(() => {
    process.env.CONVEX_SITE_URL = 'https://example.convex.site';
  });

  it('passes Better Auth jwks documents through to the plugin', () => {
    const rawJwks = JSON.stringify([
      {
        id: 'kid-1',
        publicKey: '{"kty":"OKP","crv":"Ed25519","x":"abc"}',
        privateKey: '{"kty":"OKP"}',
        createdAt: 1,
      },
    ]);

    expect(resolveBetterAuthPluginJwks(rawJwks)).toBe(rawJwks);
  });

  it('builds an inline auth provider for Better Auth jwks documents', () => {
    const rawJwks = JSON.stringify([
      {
        id: 'kid-1',
        publicKey: '{"kty":"OKP","crv":"Ed25519","x":"abc"}',
        privateKey: '{"kty":"OKP"}',
        createdAt: 1,
      },
    ]);

    const provider = resolveAuthConfigProvider(rawJwks);
    expect(isCustomJwtProvider(provider)).toBe(true);
    if (!isCustomJwtProvider(provider)) {
      throw new Error('Expected a customJwt provider');
    }
    expect(provider.jwks.startsWith('data:')).toBe(true);
  });

  it('accepts an already-public jwks object for auth config', () => {
    const rawJwks = JSON.stringify({
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: 'abc' }],
    });

    const provider = resolveAuthConfigProvider(rawJwks);
    expect(isCustomJwtProvider(provider)).toBe(true);
    if (!isCustomJwtProvider(provider)) {
      throw new Error('Expected a customJwt provider');
    }
    expect(provider.jwks.startsWith('data:application/json')).toBe(true);

    const [, encodedJson = ''] = provider.jwks.split(',', 2);
    expect(JSON.parse(decodeURIComponent(encodedJson))).toEqual({
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: 'abc' }],
    });
  });

  it('does not pass public jwks through to the Better Auth plugin', () => {
    const rawJwks = JSON.stringify({
      keys: [{ kid: 'kid-1', kty: 'OKP', crv: 'Ed25519', x: 'abc' }],
    });

    expect(resolveBetterAuthPluginJwks(rawJwks)).toBeUndefined();
  });
});
