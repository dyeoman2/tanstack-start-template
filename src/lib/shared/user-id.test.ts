import { describe, expect, it } from 'vitest';
import { assertUserId, normalizeUserId } from '~/lib/shared/user-id';

describe('normalizeUserId', () => {
  it('returns a trimmed string identifier', () => {
    expect(normalizeUserId('  user_123  ')).toBe('user_123');
  });

  it('converts numeric identifiers to strings', () => {
    expect(normalizeUserId(42)).toBe('42');
    expect(normalizeUserId(42n)).toBe('42');
  });

  it('reads nested identifier fields in priority order', () => {
    expect(normalizeUserId({ id: { userId: { _id: 'nested-user' } } })).toBe('nested-user');
  });

  it('returns null for empty and cyclic values', () => {
    const cyclic: { id?: unknown } = {};
    cyclic.id = cyclic;

    expect(normalizeUserId('   ')).toBeNull();
    expect(normalizeUserId(cyclic)).toBeNull();
  });
});

describe('assertUserId', () => {
  it('returns the normalized user id when present', () => {
    expect(assertUserId({ userId: 'abc-123' })).toBe('abc-123');
  });

  it('throws the provided error message when no identifier is found', () => {
    expect(() => assertUserId({}, 'Missing user id')).toThrow('Missing user id');
  });
});
