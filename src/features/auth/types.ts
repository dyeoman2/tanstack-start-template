export type UserRole = 'user' | 'admin';
export type TeamRole = 'admin' | 'edit' | 'view';

export const USER_ROLES = {
  USER: 'user' as const,
  ADMIN: 'admin' as const,
} satisfies Record<string, UserRole>;

export const TEAM_ROLES = {
  ADMIN: 'admin' as const,
  EDIT: 'edit' as const,
  VIEW: 'view' as const,
} satisfies Record<string, TeamRole>;

export const DEFAULT_ROLE: UserRole = USER_ROLES.USER;
