import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ConvexReactClient } from 'convex/react';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { AutumnWrapper } from '~/components/AutumnWrapper';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { ThemeProvider } from '~/components/theme-provider';
import { ToastProvider } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { normalizeUserId } from '~/lib/shared/user-id';
import type { RouterAuthContext } from '~/router';

const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.VITE_CONVEX_SITE_URL;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL or VITE_CONVEX_SITE_URL environment variable is required');
}

const convex = new ConvexReactClient(convexUrl, {
  expectAuth: true,
});

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
            role: isAdmin ? 'admin' : 'user',
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
  }, [isAuthenticated, user?.id, user?.email, user?.name, isPending, isAdmin]);

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
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <AuthProvider>
          <AutumnWrapper>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
          </AutumnWrapper>
        </AuthProvider>
      </ConvexBetterAuthProvider>
    </ErrorBoundaryWrapper>
  );
}
