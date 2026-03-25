import { api } from '@convex/_generated/api';
import { useConvexAuth, useQuery } from 'convex/react';
import { useMemo } from 'react';
import type { AuthSessionData } from '~/features/auth/auth-client';
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
    mfaEnabled?: boolean;
    mfaRequired?: boolean;
    requiresMfaSetup?: boolean;
    requiresMfaVerification?: boolean;
    recentStepUpAt?: number | null;
    recentStepUpValidUntil?: number | null;
  } | null;
  hasSession: boolean;
  isAuthenticated: boolean;
  isSiteAdmin: boolean;
  requiresEmailVerification: boolean;
  requiresMfaSetup: boolean;
  requiresMfaVerification: boolean;
  hasRecentStepUp: boolean;
  isImpersonating: boolean;
  impersonatedByUserId?: string;
  isPending: boolean;
  error: Error | null;
}

export function useAuth(options: AuthOptions = {}): AuthResult {
  const { fetchRole = true } = options;

  // Use the lightweight auth state hook
  const authState = useAuthState();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const { data: session, isPending: sessionPending, error } = useSession();

  const hasSession = authState.isAuthenticated;
  const shouldWaitForConvexAuth = hasSession && isConvexAuthLoading;
  const canUseConvex = hasSession && isConvexAuthenticated;
  const shouldFetchProfile = canUseConvex && !sessionPending && fetchRole;

  // Pass "skip" to avoid running the Convex query when profile data is not needed
  const profileQuery = useQuery(api.users.getCurrentUserProfile, shouldFetchProfile ? {} : 'skip');

  // Only use profile data when we should be fetching it
  const profile = shouldFetchProfile ? profileQuery : undefined;
  const sessionData: AuthSessionData | undefined = session?.session;
  const sessionAuthMethod =
    typeof sessionData === 'object' &&
    sessionData !== null &&
    'authMethod' in sessionData &&
    typeof sessionData.authMethod === 'string'
      ? sessionData.authMethod
      : null;
  const sessionMfaVerified =
    typeof sessionData === 'object' &&
    sessionData !== null &&
    'mfaVerified' in sessionData &&
    typeof sessionData.mfaVerified === 'boolean'
      ? sessionData.mfaVerified
      : false;
  const impersonatedByUserId =
    typeof sessionData?.impersonatedBy === 'string' && sessionData.impersonatedBy.length > 0
      ? sessionData.impersonatedBy
      : undefined;
  const isImpersonating = impersonatedByUserId !== undefined;

  const isPending =
    sessionPending ||
    shouldWaitForConvexAuth ||
    (canUseConvex && shouldFetchProfile && profile === undefined);

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
  const requiresMfaSetup =
    !!session?.user && (shouldFetchProfile ? (profile?.requiresMfaSetup ?? false) : false);
  const hasRecentStepUp =
    !!session?.user &&
    (shouldFetchProfile
      ? typeof profile?.recentStepUpValidUntil === 'number' &&
        profile.recentStepUpValidUntil > Date.now()
      : false);
  const requiresMfaVerification =
    !!session?.user &&
    shouldFetchProfile &&
    (profile?.mfaRequired ?? false) &&
    !requiresMfaSetup &&
    !hasRecentStepUp &&
    sessionAuthMethod !== 'passkey' &&
    !sessionMfaVerified;

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
            currentOrganization: shouldFetchProfile ? (profile?.currentOrganization ?? null) : null,
            mfaEnabled: shouldFetchProfile ? (profile?.mfaEnabled ?? false) : false,
            mfaRequired: shouldFetchProfile ? (profile?.mfaRequired ?? true) : true,
            requiresMfaSetup,
            requiresMfaVerification,
            recentStepUpAt: shouldFetchProfile ? (profile?.recentStepUpAt ?? null) : null,
            recentStepUpValidUntil: shouldFetchProfile
              ? (profile?.recentStepUpValidUntil ?? null)
              : null,
          }
        : null,
      hasSession,
      isAuthenticated: canUseConvex,
      isSiteAdmin,
      requiresEmailVerification,
      requiresMfaSetup,
      requiresMfaVerification,
      hasRecentStepUp,
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
      requiresMfaSetup,
      requiresMfaVerification,
      hasRecentStepUp,
      profile?.currentOrganization,
      profile?.mfaEnabled,
      profile?.mfaRequired,
      profile?.recentStepUpAt,
      profile?.recentStepUpValidUntil,
      profile?.phoneNumber,
      hasSession,
      canUseConvex,
      isImpersonating,
      impersonatedByUserId,
      isPending,
      error,
      shouldFetchProfile,
    ],
  );
}
