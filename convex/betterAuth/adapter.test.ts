import { describe, expect, it } from 'vitest';
import { getOptions } from './options';

describe('better auth adapter integration', () => {
  it('can build tooling options with the deterministic loopback fallback', () => {
    delete process.env.BETTER_AUTH_URL;

    expect(() => getOptions('tooling')).not.toThrow();
  });
});
