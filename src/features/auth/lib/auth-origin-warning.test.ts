import { describe, expect, it } from 'vitest';
import { getLoopbackAuthOriginMismatch } from './auth-origin-warning';

describe('getLoopbackAuthOriginMismatch', () => {
  it('returns a mismatch when localhost and 127.0.0.1 differ', () => {
    expect(getLoopbackAuthOriginMismatch('http://127.0.0.1:3000', 'http://localhost:3000')).toEqual(
      {
        browserOrigin: 'http://127.0.0.1:3000',
        canonicalOrigin: 'http://localhost:3000',
      },
    );
  });

  it('returns null when loopback origins match', () => {
    expect(
      getLoopbackAuthOriginMismatch('http://localhost:3000', 'http://localhost:3000'),
    ).toBeNull();
  });

  it('returns null for non-loopback origins', () => {
    expect(
      getLoopbackAuthOriginMismatch('https://app.example.com', 'https://auth.example.com'),
    ).toBeNull();
  });
});
