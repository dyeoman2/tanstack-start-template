import type { UserRole } from '../auth/types';

/**
 * Admin feature types
 * Matches Convex query return types
 */

/**
 * User type matching Convex admin.getAllUsers return type
 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  emailVerified: boolean;
  createdAt: number; // Unix timestamp from Convex
  updatedAt: number; // Unix timestamp from Convex
}
