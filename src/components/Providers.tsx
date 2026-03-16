import { api } from '@convex/_generated/api';
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { AuthQueryProvider } from '@daveyplate/better-auth-tanstack';
import { AuthUIProviderTanstack } from '@daveyplate/better-auth-ui/tanstack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAction, useConvexAuth } from 'convex/react';
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { ThemeProvider } from '~/components/theme-provider';
import { Toaster } from '~/components/ui/sonner';
import { ToastProvider } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';
import { authUiViewPaths } from '~/features/auth/auth-ui';
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

function AuthUiProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  const navigateWithBrowser = (href: string, replace = false) => {
    if (typeof window === 'undefined') {
      return;
    }

    if (/^https?:\/\//.test(href)) {
      if (replace) {
        window.location.replace(href);
      } else {
        window.location.assign(href);
      }
      return;
    }

    if (replace) {
      window.history.replaceState(window.history.state, '', href);
    } else {
      window.history.pushState(window.history.state, '', href);
    }

    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const AuthLink = ({
    href,
    className,
    children: linkChildren,
  }: {
    href: string;
    className?: string;
    children: ReactNode;
  }) => {
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        /^https?:\/\//.test(href)
      ) {
        return;
      }

      event.preventDefault();
      navigateWithBrowser(href);
    };

    return (
      <a href={href} className={className} onClick={handleClick}>
        {linkChildren}
      </a>
    );
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryProvider>
        <AuthUIProviderTanstack
          account={{
            basePath: '/app/profile',
            fields: ['name', 'phoneNumber'],
          }}
          additionalFields={{
            phoneNumber: {
              description: 'Add a phone number to your account profile.',
              label: 'Phone Number',
              placeholder: '(805) 123-4567',
              type: 'string',
            },
          }}
          authClient={authClient}
          basePath=""
          baseURL={typeof window === 'undefined' ? '' : window.location.origin}
          Link={AuthLink}
          credentials={{ forgotPassword: true }}
          navigate={(href) => navigateWithBrowser(href)}
          onSessionChange={async () => {
            if (typeof window !== 'undefined') {
              window.location.reload();
            }
          }}
          organization={{
            basePath: '/app/organizations',
            pathMode: 'slug',
            personalPath: '/app/profile',
          }}
          passkey
          replace={(href) => navigateWithBrowser(href, true)}
          twoFactor={['totp']}
          viewPaths={authUiViewPaths}
        >
          {children}
        </AuthUIProviderTanstack>
      </AuthQueryProvider>
    </QueryClientProvider>
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
        <AuthUiProvider>
          <AuthProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <ToastProvider>
                {children}
                <Toaster richColors />
              </ToastProvider>
            </ThemeProvider>
          </AuthProvider>
        </AuthUiProvider>
      </ConvexBetterAuthProvider>
    </ErrorBoundaryWrapper>
  );
}
