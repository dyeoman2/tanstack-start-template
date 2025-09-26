import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ClientOnly } from '~/components/ClientOnly';
import { ErrorBoundaryWrapper } from '~/components/ErrorBoundary';
import { ToastProvider } from '~/components/ui/toast';
import { queryClient } from '~/lib/query-client';
import { SYSTEM_KEYS } from '~/lib/query-keys';
import { getEnvironmentInfoServerFn } from '~/lib/server/server-functions.server';

function EnvironmentAwareProviders({ children }: { children: ReactNode }) {
  return (
    <ClientOnly
      fallback={
        <ErrorBoundaryWrapper
          title="Application Error"
          description="An unexpected error occurred in the application. Please refresh the page to try again."
          showDetails={false}
        >
          {children}
        </ErrorBoundaryWrapper>
      }
    >
      <EnvironmentQueryWrapper>{children}</EnvironmentQueryWrapper>
    </ClientOnly>
  );
}

function EnvironmentQueryWrapper({ children }: { children: ReactNode }) {
  const { data: envInfo } = useQuery({
    queryKey: SYSTEM_KEYS.ENVIRONMENT,
    queryFn: () => getEnvironmentInfoServerFn(),
    staleTime: Infinity, // Environment info doesn't change during runtime
    gcTime: Infinity,
  });

  const isDevelopment = envInfo?.isDevelopment ?? false;

  return (
    <ErrorBoundaryWrapper
      title="Application Error"
      description="An unexpected error occurred in the application. Please refresh the page to try again."
      showDetails={isDevelopment}
    >
      {children}
    </ErrorBoundaryWrapper>
  );
}

function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <EnvironmentAwareProviders>{children}</EnvironmentAwareProviders>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function EnvironmentAwareErrorBoundary({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}

export function Providers({ children }: { children: ReactNode }) {
  return <EnvironmentAwareErrorBoundary>{children}</EnvironmentAwareErrorBoundary>;
}
