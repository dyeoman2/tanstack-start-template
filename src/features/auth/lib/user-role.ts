import { USER_ROLES, type UserRole } from '../types';

export function normalizeUserRole(role: string | string[] | undefined): UserRole {
  if (Array.isArray(role)) {
    return role.includes(USER_ROLES.ADMIN) ? USER_ROLES.ADMIN : USER_ROLES.USER;
  }

  return role === USER_ROLES.ADMIN ? USER_ROLES.ADMIN : USER_ROLES.USER;
}

export function deriveIsSiteAdmin(role: UserRole): boolean {
  return role === USER_ROLES.ADMIN;
}
