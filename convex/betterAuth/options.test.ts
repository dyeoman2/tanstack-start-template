import { describe, expect, it } from 'vitest';
import { getOptions } from './options';

describe('getOptions', () => {
  it('omits runtime env-backed Better Auth settings in runtime mode', () => {
    const options = getOptions('runtime');

    expect(options.trustedOrigins).toBeUndefined();
    expect(options.rateLimit).toBeUndefined();
  });

  it('includes runtime env-backed Better Auth settings in tooling mode', () => {
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';

    const options = getOptions('tooling');

    expect(options.trustedOrigins).toBeTypeOf('function');
    expect(options.rateLimit?.storage).toBe('database');
  });

  it('can build tooling options with the deterministic loopback fallback', () => {
    delete process.env.BETTER_AUTH_URL;

    expect(() => getOptions('tooling')).not.toThrow();
  });
});
