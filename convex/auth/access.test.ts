import { describe, expect, it } from 'vitest';
import { isAdminRole, ADMIN_ACCESS, EDIT_ACCESS, NO_ACCESS, SITE_ADMIN_ACCESS, VIEW_ACCESS } from './access';

describe('isAdminRole', () => {
  it('accepts direct admin role values', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('user')).toBe(false);
  });

  it('accepts admin role arrays from Better Auth plugin payloads', () => {
    expect(isAdminRole(['user', 'admin'])).toBe(true);
    expect(isAdminRole(['user'])).toBe(false);
  });
});

describe('access constants', () => {
  it('preserves the expected permission lattice', () => {
    expect(SITE_ADMIN_ACCESS.delete).toBe(true);
    expect(ADMIN_ACCESS.edit).toBe(true);
    expect(EDIT_ACCESS.view).toBe(true);
    expect(VIEW_ACCESS.edit).toBe(false);
    expect(NO_ACCESS.view).toBe(false);
  });
});
