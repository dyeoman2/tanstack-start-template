import { ConvexError } from 'convex/values';

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'ADMIN_REQUIRED'
  | 'NOT_FOUND'
  | 'VALIDATION';

export function throwConvexError(code: AuthErrorCode, message: string): never {
  throw new ConvexError({ code, message });
}
