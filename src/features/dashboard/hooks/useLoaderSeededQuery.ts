import { useQuery } from 'convex/react';
import type { FunctionReference } from 'convex/server';

type LoaderSeededQueryResult<Query extends FunctionReference<'query'>> = {
  data: Query['_returnType'] | null;
  isLivePending: boolean;
};

export function useLoaderSeededQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: Query['_args'],
  initial: Query['_returnType'] | null,
): LoaderSeededQueryResult<Query> {
  const live = useQuery(query, args);

  return {
    data: live ?? initial,
    isLivePending: live === undefined,
  };
}
