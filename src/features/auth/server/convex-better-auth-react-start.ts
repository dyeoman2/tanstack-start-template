import { convexBetterAuthReactStart } from '@convex-dev/better-auth/react-start';
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server';

type ConvexAuthReactStart = ReturnType<typeof convexBetterAuthReactStart>;

let cachedConvexAuthReactStart: ConvexAuthReactStart | null = null;

function getRequiredClientEnv(name: 'VITE_CONVEX_URL' | 'VITE_CONVEX_SITE_URL'): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

export function getConvexAuthReactStart(): ConvexAuthReactStart {
  if (cachedConvexAuthReactStart) {
    return cachedConvexAuthReactStart;
  }

  cachedConvexAuthReactStart = convexBetterAuthReactStart({
    convexUrl: getRequiredClientEnv('VITE_CONVEX_URL'),
    convexSiteUrl: getRequiredClientEnv('VITE_CONVEX_SITE_URL'),
  });

  return cachedConvexAuthReactStart;
}

export const convexAuthReactStart = {
  fetchAuthAction<Action extends FunctionReference<'action'>>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>> {
    return getConvexAuthReactStart().fetchAuthAction(action, ...args);
  },
  fetchAuthMutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    return getConvexAuthReactStart().fetchAuthMutation(mutation, ...args);
  },
  fetchAuthQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>> {
    return getConvexAuthReactStart().fetchAuthQuery(query, ...args);
  },
  handler(...args: Parameters<ConvexAuthReactStart['handler']>) {
    return getConvexAuthReactStart().handler(...args);
  },
} satisfies Pick<
  ConvexAuthReactStart,
  'fetchAuthAction' | 'fetchAuthMutation' | 'fetchAuthQuery' | 'handler'
>;
