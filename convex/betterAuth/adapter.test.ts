import { describe, expect, it } from 'vitest';
import { getOptions } from './options';

describe('better auth adapter integration', () => {
  it('can build tooling options without BETTER_AUTH_URL', () => {
    delete process.env.BETTER_AUTH_URL;
    delete process.env.SITE_URL;

    expect(() => getOptions('tooling')).not.toThrow();
  });
});
