import { describe, expect, it } from 'vitest';
import {
  normalizeBetterAuthJwksForEnv,
  parseConvexRunStdout,
  sliceConvexCliJsonPayload,
} from './deploy-env-helpers';

describe('deploy env jwks helpers', () => {
  it('extracts the JSON payload from noisy convex output', () => {
    expect(
      parseConvexRunStdout(
        '\n> convex run auth:getLatestJwks\n[{"id":"kid-1","publicKey":"{}"}]\n',
      ),
    ).toBe('[{"id":"kid-1","publicKey":"{}"}]');
  });

  it('converts Better Auth jwks docs to public-only JWKS', () => {
    const normalized = normalizeBetterAuthJwksForEnv(
      JSON.stringify([
        {
          id: 'kid-1',
          publicKey: JSON.stringify({
            crv: 'Ed25519',
            d: 'private-should-not-survive',
            kid: 'kid-1',
            kty: 'OKP',
            x: 'abc',
          }),
        },
      ]),
    );

    expect(JSON.parse(normalized)).toEqual({
      keys: [
        {
          crv: 'Ed25519',
          kid: 'kid-1',
          kty: 'OKP',
          x: 'abc',
        },
      ],
    });
  });

  it('preserves public JWKS payloads', () => {
    const normalized = normalizeBetterAuthJwksForEnv(
      JSON.stringify({
        keys: [{ kid: 'kid-1', kty: 'OKP', x: 'abc' }],
      }),
    );

    expect(JSON.parse(normalized)).toEqual({
      keys: [{ kid: 'kid-1', kty: 'OKP', x: 'abc' }],
    });
  });

  it('rejects unsupported JWKS payloads', () => {
    expect(() => normalizeBetterAuthJwksForEnv('{"unexpected":true}')).toThrow(
      'Better Auth JWKS output is neither Better Auth key docs nor public JWKS.',
    );
  });

  it('keeps the last JSON-looking line from convex env output', () => {
    expect(sliceConvexCliJsonPayload('noise\n{"keys":[]}\n')).toBe('{"keys":[]}');
  });
});
