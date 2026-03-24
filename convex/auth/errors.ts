import { ConvexError } from 'convex/values';

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ADMIN_REQUIRED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMITED';

export function throwConvexError(code: AuthErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
