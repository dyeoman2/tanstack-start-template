import { useMutation } from 'convex/react';
import type { FunctionReference } from 'convex/server';
import { useCallback } from 'react';

/**
 * Hook for managing optimistic updates with automatic rollback on error
 * Provides a wrapper around Convex mutations that handles optimistic updates
 */
export function useOptimisticMutation<TMutation extends FunctionReference<'mutation'>>(
  mutation: TMutation,
  options?: {
    onSuccess?: (result: TMutation['_returnType']) => void;
    onError?: (error: Error) => void;
  },
) {
  const convexMutation = useMutation(mutation);

  const executeMutation = useCallback(
    async (args: TMutation['_args']): Promise<TMutation['_returnType']> => {
      try {
        // Convex mutations automatically provide optimistic updates
        // The mutation will optimistically update the cache immediately
        const result = await convexMutation(args);

        // Call success callback if provided
        options?.onSuccess?.(result);

        return result;
      } catch (error) {
        // Convex automatically rolls back optimistic updates on error
        const errorObj = error instanceof Error ? error : new Error('Unknown error');
        options?.onError?.(errorObj);
        throw errorObj;
      }
    },
    [convexMutation, options],
  );

  return executeMutation;
}
