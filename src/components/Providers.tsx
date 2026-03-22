import { api } from '@convex/_generated/api';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { ThemeProvider } from '~/components/theme-provider';
import { Toaster } from '~/components/ui/sonner';
import { ToastProvider } from '~/components/ui/toast';
import { rawAuthClient } from '~/features/auth/auth-client-internal';
import { DevAuthOriginWarning } from '~/features/auth/components/DevAuthOriginWarning';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { convexClient } from '~/lib/convexClient';
import { setupClaimRefresh } from '~/lib/roleRefresh';
import { setSentryUser } from '~/lib/sentry';
import { normalizeUserId } from '~/lib/shared/user-id';
import type { RouterAuthContext } from '~/router';

// Auth context for sharing auth state across the app
const AuthContext = createContext<{
  authContext: RouterAuthContext;
  isAuthLoading: boolean;
}>({
  authContext: { authenticated: false, user: null },
  isAuthLoading: true,
});

export function useAuthContext() {
  return useContext(AuthContext);
}

interface AuthProviderProps {
  children: ReactNode;
}

function AuthProvider({ children }: AuthProviderProps) {
  const { user, isAuthenticated, isPending, isSiteAdmin } = useAuth();
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexAuthLoading } =
    useConvexAuth();
  const ensureCurrentUserContext = useAction(api.users.ensureCurrentUserContext);
  const [authContext, setAuthContext] = useState<RouterAuthContext>({
    authenticated: false,
    user: null,
  });

  // Use ref to track last computed values to avoid unnecessary updates
  const lastValuesRef = useRef({
    isAuthenticated,
    userId: user?.id,
    userEmail: user?.email,
    userName: user?.name,
    isPending,
    userRole: user?.role,
    isSiteAdmin,
  });

  // Update auth context only when auth state actually changes
  useEffect(() => {
    const currentValues = {
      isAuthenticated,
      userId: user?.id,
      userEmail: user?.email,
      userName: user?.name,
      isPending,
      userRole: user?.role,
      isSiteAdmin,
    };

    // Check if any auth state values have changed
    const hasChanged = Object.keys(currentValues).some(
      (key) =>
        currentValues[key as keyof typeof currentValues] !==
        lastValuesRef.current[key as keyof typeof lastValuesRef.current],
    );

    if (!hasChanged) {
      // Silent skip - no logging needed for unchanged state
      return;
    }

    // Update the ref
    lastValuesRef.current = currentValues;

    // Compute new auth context
    let newAuthContext: RouterAuthContext;

    if (isPending) {
      newAuthContext = { authenticated: false, user: null };
    } else if (isAuthenticated && user?.id && user?.email) {
      const userId = normalizeUserId(user.id);
      if (userId) {
        newAuthContext = {
          authenticated: true,
          user: {
            id: userId,
            email: user.email,
            name: user.name || undefined,
            role: user.role,
            isSiteAdmin,
          },
        };
      } else {
        newAuthContext = { authenticated: false, user: null };
      }
    } else {
      newAuthContext = { authenticated: false, user: null };
    }

    // Update the context
    setAuthContext(newAuthContext);

    // Update Sentry user context when auth state changes
    if (!isPending) {
      setSentryUser(newAuthContext.authenticated ? newAuthContext.user : null);
    }
  }, [isAuthenticated, user?.id, user?.email, user?.name, user?.role, isPending, isSiteAdmin]);

  // Setup claim refresh when component mounts
  useEffect(() => {
    return setupClaimRefresh();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isPending || isConvexAuthLoading || !isConvexAuthenticated) {
      return;
    }

    void ensureCurrentUserContext({}).catch((error) => {
      console.warn('[auth] Failed to ensure user context', error);
    });
  }, [
    ensureCurrentUserContext,
    isAuthenticated,
    isPending,
    isConvexAuthLoading,
    isConvexAuthenticated,
  ]);

  return (
    <AuthContext.Provider value={{ authContext, isAuthLoading: isPending }}>
      {children}
    </AuthContext.Provider>
  );
}

function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryWrapper
      title="Application Error"
      description="An unexpected error occurred in the application. Please refresh the page to try again."
      showDetails={false}
    >
      <ConvexBetterAuthProvider client={convexClient} authClient={rawAuthClient}>
        <QueryProvider>
          <AuthProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <ToastProvider>
                <DevAuthOriginWarning />
                {children}
                <Toaster richColors />
              </ToastProvider>
            </ThemeProvider>
          </AuthProvider>
        </QueryProvider>
      </ConvexBetterAuthProvider>
    </ErrorBoundaryWrapper>
  );
}
