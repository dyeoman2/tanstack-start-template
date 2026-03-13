import { describe, expect, it } from 'vitest';
import { USER_ROLES } from '~/features/auth/types';
import type { AdminListUser } from '../lib/admin-user-shaping';
import { normalizeAdminUser, shapeAdminUsers } from './admin-management';

describe('normalizeAdminUser', () => {
  it('maps Better Auth admin users into app-safe user objects', () => {
    const result = normalizeAdminUser({
      id: 'user_123',
      email: 'admin@example.com',
      name: 'Admin',
      role: ['admin'],
      emailVerified: true,
      banned: true,
      banReason: 'Abuse',
      banExpires: '2026-03-12T10:00:00.000Z',
      createdAt: '2026-03-10T10:00:00.000Z',
      updatedAt: '2026-03-11T10:00:00.000Z',
    });

    expect(result).toMatchObject({
      id: 'user_123',
      email: 'admin@example.com',
      name: 'Admin',
      role: USER_ROLES.ADMIN,
      emailVerified: true,
      banned: true,
      banReason: 'Abuse',
    });
    expect(result.banExpires).toBeTypeOf('number');
    expect(result.createdAt).toBeTypeOf('number');
    expect(result.updatedAt).toBeTypeOf('number');
  });
});

describe('shapeAdminUsers', () => {
  const users: AdminListUser[] = [
    {
      id: '1',
      email: 'zoe@example.com',
      name: 'Zoe',
      role: USER_ROLES.USER,
      emailVerified: false,
      banned: false,
      banReason: null,
      banExpires: null,
      onboardingStatus: 'not_started',
      onboardingDeliveryError: null,
      createdAt: 3,
      updatedAt: 3,
    },
    {
      id: '2',
      email: 'adam@example.com',
      name: 'Adam',
      role: USER_ROLES.ADMIN,
      emailVerified: true,
      banned: false,
      banReason: null,
      banExpires: null,
      onboardingStatus: 'not_started',
      onboardingDeliveryError: null,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: '3',
      email: 'maria@example.com',
      name: 'Maria',
      role: USER_ROLES.USER,
      emailVerified: true,
      banned: false,
      banReason: null,
      banExpires: null,
      onboardingStatus: 'not_started',
      onboardingDeliveryError: null,
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  it('filters by role and search, then sorts and paginates', () => {
    const result = shapeAdminUsers(users, {
      page: 1,
      pageSize: 10,
      sortBy: 'name',
      sortOrder: 'asc',
      secondarySortBy: 'email',
      secondarySortOrder: 'asc',
      search: 'ma',
      role: 'all',
      cursor: undefined,
    });

    expect(result.users.map((user) => user.id)).toEqual(['3']);
    expect(result.pagination.total).toBe(1);
  });

  it('keeps pagination metadata aligned with the page slice', () => {
    const result = shapeAdminUsers(users, {
      page: 2,
      pageSize: 1,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      secondarySortBy: 'email',
      secondarySortOrder: 'asc',
      search: '',
      role: 'all',
      cursor: undefined,
    });

    expect(result.users.map((user) => user.id)).toEqual(['3']);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasNextPage).toBe(true);
  });
});
