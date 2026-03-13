import type { UserRole } from '../../auth/types';

export type AdminUserSortField = 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
export type AdminUserSortDirection = 'asc' | 'desc';

export type AdminUserSearchParams = {
  page: number;
  pageSize: number;
  sortBy: AdminUserSortField;
  sortOrder: AdminUserSortDirection;
  secondarySortBy: AdminUserSortField;
  secondarySortOrder: AdminUserSortDirection;
  search: string;
  role: 'all' | UserRole;
  cursor?: string;
};

export type AdminListUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  needsOnboardingEmail?: boolean;
  createdAt: number;
  updatedAt: number;
  organizations?: Array<{
    id: string;
    slug: string;
    name: string;
    logo: string | null;
  }>;
};

function compareValues(
  left: string | number,
  right: string | number,
  direction: AdminUserSortDirection,
) {
  if (left === right) {
    return 0;
  }

  if (direction === 'asc') {
    return left > right ? 1 : -1;
  }

  return left < right ? 1 : -1;
}

function sortValue(user: AdminListUser, field: AdminUserSortField): string | number {
  switch (field) {
    case 'name':
      return user.name?.toLowerCase() ?? '';
    case 'email':
      return user.email.toLowerCase();
    case 'role':
      return user.role;
    case 'emailVerified':
      return user.emailVerified ? 1 : 0;
    default:
      return user.createdAt;
  }
}

export function shapeAdminUsers(users: AdminListUser[], params: AdminUserSearchParams) {
  const searchValue = params.search.trim().toLowerCase();
  let filtered = users;

  if (params.role !== 'all') {
    filtered = filtered.filter((user) => user.role === params.role);
  }

  if (searchValue) {
    filtered = filtered.filter(
      (user) =>
        user.email.toLowerCase().includes(searchValue) ||
        (user.name?.toLowerCase().includes(searchValue) ?? false),
    );
  }

  filtered = [...filtered].sort((left, right) => {
    const primary = compareValues(
      sortValue(left, params.sortBy),
      sortValue(right, params.sortBy),
      params.sortOrder,
    );

    if (primary !== 0) {
      return primary;
    }

    return compareValues(
      sortValue(left, params.secondarySortBy),
      sortValue(right, params.secondarySortBy),
      params.secondarySortOrder,
    );
  });

  const total = filtered.length;
  const start = Math.max(0, (params.page - 1) * params.pageSize);
  const end = start + params.pageSize;

  return {
    users: filtered.slice(start, end),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
      hasNextPage: end < total,
      nextCursor: end < total ? String(params.page + 1) : null,
    },
  };
}
