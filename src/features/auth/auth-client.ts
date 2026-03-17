import { type AnyUseQueryOptions, type QueryKey, skipToken, useQuery } from '@tanstack/react-query';
import type { BetterFetchOption, BetterFetchResponse } from 'better-auth/react';
import { useSyncExternalStore } from 'react';
import { rawAuthClient } from './auth-client-internal';

export { getTwoFactorRedirectHref } from './auth-client-internal';

// Better Auth's current client typings in this stack do not safely accept
// createAuthClient<typeof auth>(). Use the documented client-side inference
// path here until the upstream client generic can map the server auth instance.
// TODO: Switch to createAuthClient<typeof auth>() when the upstream generic path
// works cleanly with this Convex + Better Auth stack.
export type AuthSession = typeof rawAuthClient.$Infer.Session;
export type AuthSessionData = AuthSession['session'];
export type AuthSessionUser = AuthSession['user'];
type AppAuthClient = Pick<
  typeof rawAuthClient,
  | '$store'
  | 'changeEmail'
  | 'changePassword'
  | 'getSession'
  | 'listAccounts'
  | 'requestPasswordReset'
  | 'resetPassword'
  | 'sendVerificationEmail'
  | 'signIn'
  | 'signOut'
  | 'signUp'
  | 'updateUser'
  | 'useSession'
> & {
  admin: Pick<typeof rawAuthClient.admin, 'impersonateUser' | 'stopImpersonating'>;
  organization: Pick<
    typeof rawAuthClient.organization,
    | 'acceptInvitation'
    | 'getFullOrganization'
    | 'getInvitation'
    | 'list'
    | 'listUserInvitations'
    | 'rejectInvitation'
    | 'setActive'
  >;
  passkey: Pick<typeof rawAuthClient.passkey, 'addPasskey' | 'deletePasskey' | 'listUserPasskeys'>;
  twoFactor: Pick<
    typeof rawAuthClient.twoFactor,
    'disable' | 'enable' | 'verifyBackupCode' | 'verifyTotp'
  >;
};

export type BetterFetchRequest<TData> = ({
  fetchOptions,
}: {
  fetchOptions: BetterFetchOption;
}) => Promise<BetterFetchResponse<TData>>;

function useAuthQuery<TData>({
  queryFn,
  queryKey,
  options,
}: {
  queryFn: BetterFetchRequest<TData>;
  queryKey: QueryKey;
  options?: Partial<AnyUseQueryOptions>;
}) {
  const { data: sessionData } = useSession();

  return useQuery<TData>({
    queryKey,
    queryFn: sessionData ? () => queryFn({ fetchOptions: { throw: true } }) : skipToken,
    ...options,
  });
}

function useActiveOrganization(options?: Partial<AnyUseQueryOptions>) {
  return useAuthQuery({
    queryKey: ['auth', 'active-organization'],
    queryFn: rawAuthClient.organization.getFullOrganization,
    options,
  });
}

function useListAccounts(options?: Partial<AnyUseQueryOptions>) {
  return useAuthQuery({
    queryKey: ['auth', 'accounts'],
    queryFn: rawAuthClient.listAccounts,
    options,
  });
}

function useListOrganizations(options?: Partial<AnyUseQueryOptions>) {
  return useAuthQuery({
    queryKey: ['auth', 'organizations'],
    queryFn: rawAuthClient.organization.list,
    options,
  });
}

function useListPasskeys(options?: Partial<AnyUseQueryOptions>) {
  return useAuthQuery({
    queryKey: ['auth', 'passkeys'],
    queryFn: rawAuthClient.passkey.listUserPasskeys,
    options,
  });
}

function useInvitation(
  query: NonNullable<Parameters<typeof rawAuthClient.organization.getInvitation>[0]>['query'],
  options?: Partial<AnyUseQueryOptions>,
) {
  return useAuthQuery({
    queryKey: ['auth', 'invitation', JSON.stringify(query)],
    queryFn: ({ fetchOptions }) =>
      rawAuthClient.organization.getInvitation({
        query,
        fetchOptions,
      }),
    options,
  });
}

export const authHooks = {
  useActiveOrganization,
  useAuthQuery,
  useInvitation,
  useListAccounts,
  useListOrganizations,
  useListPasskeys,
};

const authTransitionListeners = new Set<() => void>();
let isSigningOut = false;

function emitAuthTransition() {
  for (const listener of authTransitionListeners) {
    listener();
  }
}

function setSigningOut(nextValue: boolean) {
  if (isSigningOut === nextValue) {
    return;
  }

  isSigningOut = nextValue;
  emitAuthTransition();
}

export function useIsSigningOut() {
  return useSyncExternalStore(
    (listener) => {
      authTransitionListeners.add(listener);
      return () => {
        authTransitionListeners.delete(listener);
      };
    },
    () => isSigningOut,
    () => false,
  );
}

export function clearSigningOutState() {
  setSigningOut(false);
}

export const authClient: AppAuthClient = rawAuthClient;

export const { signIn, useSession } = authClient;

export async function signOut(...args: Parameters<typeof authClient.signOut>) {
  setSigningOut(true);

  try {
    return await authClient.signOut(...args);
  } catch (error) {
    setSigningOut(false);
    throw error;
  }
}
