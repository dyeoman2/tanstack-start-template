import { QueryClient } from '@tanstack/react-query';

// Custom error types for better error handling
class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

class NetworkError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'NetworkError';
    this.status = status;
  }
}

// Global React Query client configuration
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data stays fresh longer
      gcTime: 10 * 60 * 1000, // 10 minutes - keep in cache longer
      retry: (failureCount, error) => {
        // Custom retry logic for different error types
        if (error instanceof AuthError) {
          // Don't retry auth errors - they're permanent for this session
          return false;
        }

        if (error instanceof NetworkError) {
          // Retry network errors up to 3 times with exponential backoff
          if (error.status && error.status >= 400 && error.status < 500) {
            // Don't retry 4xx client errors (except 408, 429 which are retryable)
            return error.status === 408 || error.status === 429 ? failureCount < 3 : false;
          }
          return failureCount < 3;
        }

        // Default retry for unknown errors
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff, max 30s
      refetchOnWindowFocus: false, // Prevent unnecessary refetches
      refetchOnReconnect: true, // Refetch when connection restored
    },
    mutations: {
      retry: false, // Mutations should not be retried automatically
      onError: (error) => {
        // Global error handling for mutations
        console.error('🔴 Mutation error:', error);

        // Could integrate with error reporting service here
        // reportError(error);
      },
      onSuccess: (data) => {
        // Optional: Global success logging for mutations
        if (import.meta.env.DEV) {
          console.log('✅ Mutation success:', data);
        }
      },
    },
  },
});
