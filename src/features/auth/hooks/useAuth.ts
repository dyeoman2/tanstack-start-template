import { api } from '@convex/_generated/api';
import { useConvexAuth } from 'convex/react';
import { useQuery } from 'convex/react';
import { useMemo } from 'react';
import { useSession } from '~/features/auth/auth-client';
import { deriveIsSiteAdmin } from '../lib/user-role';
import type { UserRole } from '../types';
import { DEFAULT_ROLE, USER_ROLES } from '../types';
import { useAuthState } from './useAuthState';

export interface AuthOptions {
  /** Whether to fetch role data from the database. Defaults to true. */
  fetchRole?: boolean;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name?: string;
    phoneNumber?: string | null;
    role: UserRole;
    isSiteAdmin: boolean;
    emailVerified?: boolean;
    requiresEmailVerification?: boolean;
    currentOrganization?: {
      id: string;
      name: string;
      role: string;
    } | null;
  } | null;
  isAuthenticated: boolean;
  isSiteAdmin: boolean;
  requiresEmailVerification: boolean;
  isImpersonating: boolean;
  impersonatedByUserId?: string;
  isPending: boolean;
  error: Error | null;
}

export function useAuth(options: AuthOptions = {}): AuthResult {
  const { fetchRole = true } = options;

  // Use the lightweight auth state hook
  const authState = useAuthState();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } = useConvexAuth();
  const { data: session, isPending: sessionPending, error } = useSession();

  const hasSession = authState.isAuthenticated;
  const shouldWaitForConvexAuth = hasSession && isConvexAuthLoading;
  const canUseConvex = hasSession && isConvexAuthenticated;
  const shouldFetchProfile = canUseConvex && !sessionPending && fetchRole;

  // Pass "skip" to avoid running the Convex query when profile data is not needed
  const profileQuery = useQuery(api.users.getCurrentUserProfile, shouldFetchProfile ? {} : 'skip');

  // Only use profile data when we should be fetching it
  const profile = shouldFetchProfile ? profileQuery : undefined;
  const impersonatedByUserId =
    typeof session?.session?.impersonatedBy === 'string' && session.session.impersonatedBy.length > 0
      ? session.session.impersonatedBy
      : undefined;
  const isImpersonating = impersonatedByUserId !== undefined;

  const isPending = sessionPending || shouldWaitForConvexAuth || (canUseConvex && shouldFetchProfile && profile === undefined);

  // Determine role: use profile role if available, otherwise default to user
  // If we're not fetching roles, default to user
  const role: UserRole = shouldFetchProfile
    ? profile?.role === USER_ROLES.ADMIN
      ? USER_ROLES.ADMIN
      : USER_ROLES.USER
    : DEFAULT_ROLE;
  const isSiteAdmin = deriveIsSiteAdmin(role);
  const requiresEmailVerification =
    !!session?.user && (shouldFetchProfile ? (profile?.requiresEmailVerification ?? false) : false);

  // Memoize return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      user: session?.user
        ? {
            ...session.user,
            role,
            isSiteAdmin,
            emailVerified: session.user.emailVerified,
            requiresEmailVerification,
            phoneNumber: shouldFetchProfile ? profile?.phoneNumber || null : null,
            currentOrganization: shouldFetchProfile ? profile?.currentOrganization ?? null : null,
          }
        : null,
      isAuthenticated: canUseConvex,
      isSiteAdmin,
      requiresEmailVerification,
      isImpersonating,
      impersonatedByUserId,
      isPending,
      error,
    }),
    [
      session?.user,
      role,
      isSiteAdmin,
      requiresEmailVerification,
      profile?.currentOrganization,
      profile?.phoneNumber,
      canUseConvex,
      isImpersonating,
      impersonatedByUserId,
      isPending,
      error,
      shouldFetchProfile,
    ],
  );
}
