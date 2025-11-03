import type { Doc } from '@convex/_generated/dataModel';

// Use generated Convex type for consistency
export type UserProfile = Doc<'userProfiles'>;
export type UserRole = UserProfile['role']; // Auto-generated: 'user' | 'admin'

// Role constants for type-safe usage
export const USER_ROLES = {
  USER: 'user' as UserRole,
  ADMIN: 'admin' as UserRole,
} as const;

export const DEFAULT_ROLE: UserRole = USER_ROLES.USER;
