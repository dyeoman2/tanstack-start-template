import { describe, expect, it } from 'vitest';
import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';

describe('normalizeUserRole', () => {
  it('normalizes scalar and array Better Auth role payloads', () => {
    expect(normalizeUserRole('admin')).toBe('admin');
    expect(normalizeUserRole('user')).toBe('user');
    expect(normalizeUserRole(['user', 'admin'])).toBe('admin');
    expect(normalizeUserRole(['user'])).toBe('user');
  });
});

describe('deriveIsSiteAdmin', () => {
  it('derives site admin from normalized role', () => {
    expect(deriveIsSiteAdmin('admin')).toBe(true);
    expect(deriveIsSiteAdmin('user')).toBe(false);
  });
});

describe('access constants', () => {
  it('preserves the expected permission lattice', async () => {
    process.env.BETTER_AUTH_SECRET = 'test-secret';

    const { ADMIN_ACCESS, EDIT_ACCESS, NO_ACCESS, SITE_ADMIN_ACCESS, VIEW_ACCESS } =
      await import('./access');

    expect(SITE_ADMIN_ACCESS.delete).toBe(true);
    expect(ADMIN_ACCESS.edit).toBe(true);
    expect(EDIT_ACCESS.view).toBe(true);
    expect(VIEW_ACCESS.edit).toBe(false);
    expect(NO_ACCESS.view).toBe(false);
  });
});
