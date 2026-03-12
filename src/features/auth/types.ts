export type UserRole = 'user' | 'admin';

export const USER_ROLES = {
  USER: 'user' as const,
  ADMIN: 'admin' as const,
} satisfies Record<string, UserRole>;

export const DEFAULT_ROLE: UserRole = USER_ROLES.USER;
