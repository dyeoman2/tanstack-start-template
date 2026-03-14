import { describe, expect, it } from 'vitest';
import { USER_ROLES } from '../types';
import { deriveIsSiteAdmin, normalizeUserRole } from './user-role';

describe('normalizeUserRole', () => {
  it('returns admin when an admin role appears in an array', () => {
    expect(normalizeUserRole([USER_ROLES.USER, USER_ROLES.ADMIN])).toBe(USER_ROLES.ADMIN);
  });

  it('falls back to user when the array does not include admin', () => {
    expect(normalizeUserRole([USER_ROLES.USER])).toBe(USER_ROLES.USER);
  });

  it('returns admin for the admin scalar role', () => {
    expect(normalizeUserRole(USER_ROLES.ADMIN)).toBe(USER_ROLES.ADMIN);
  });

  it('falls back to user for unknown or missing values', () => {
    expect(normalizeUserRole('owner')).toBe(USER_ROLES.USER);
    expect(normalizeUserRole(undefined)).toBe(USER_ROLES.USER);
  });
});

describe('deriveIsSiteAdmin', () => {
  it('only returns true for admin users', () => {
    expect(deriveIsSiteAdmin(USER_ROLES.ADMIN)).toBe(true);
    expect(deriveIsSiteAdmin(USER_ROLES.USER)).toBe(false);
  });
});
