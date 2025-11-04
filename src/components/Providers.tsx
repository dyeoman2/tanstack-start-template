import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { AutumnClientProvider } from '~/components/AutumnProvider';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { ThemeProvider } from '~/components/theme-provider';
import { ToastProvider } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { USER_ROLES } from '~/features/auth/types';
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
  const { user, isAuthenticated, isPending, isAdmin } = useAuth();
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
    isAdmin,
  });

  // Update auth context only when auth state actually changes
  useEffect(() => {
    const currentValues = {
      isAuthenticated,
      userId: user?.id,
      userEmail: user?.email,
      userName: user?.name,
      isPending,
      isAdmin,
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
            role: isAdmin ? USER_ROLES.ADMIN : USER_ROLES.USER,
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
  }, [isAuthenticated, user?.id, user?.email, user?.name, isPending, isAdmin]);

  // Setup claim refresh when component mounts
  useEffect(() => {
    return setupClaimRefresh();
  }, []);

  return (
    <AuthContext.Provider value={{ authContext, isAuthLoading: isPending }}>
      {children}
    </AuthContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryWrapper
      title="Application Error"
      description="An unexpected error occurred in the application. Please refresh the page to try again."
      showDetails={false}
    >
      <ConvexBetterAuthProvider client={convexClient} authClient={authClient}>
        <AutumnClientProvider>
          <AuthProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
          </AuthProvider>
        </AutumnClientProvider>
      </ConvexBetterAuthProvider>
    </ErrorBoundaryWrapper>
  );
}
