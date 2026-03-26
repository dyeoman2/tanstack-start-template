import { ConvexError } from 'convex/values';

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'MFA_REQUIRED'
  | 'MFA_SETUP_REQUIRED'
  | 'ADMIN_REQUIRED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED';

export function throwConvexError(code: AuthErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
