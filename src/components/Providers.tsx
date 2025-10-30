import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react';
import { ConvexReactClient } from 'convex/react';
import type { ReactNode } from 'react';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { ThemeProvider } from '~/components/theme-provider';
import { ToastProvider } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';

const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.VITE_CONVEX_SITE_URL;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL or VITE_CONVEX_SITE_URL environment variable is required');
}

const convex = new ConvexReactClient(convexUrl, {
  expectAuth: true,
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundaryWrapper
      title="Application Error"
      description="An unexpected error occurred in the application. Please refresh the page to try again."
      showDetails={false}
    >
      <ConvexBetterAuthProvider client={convex} authClient={authClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </ConvexBetterAuthProvider>
    </ErrorBoundaryWrapper>
  );
}
