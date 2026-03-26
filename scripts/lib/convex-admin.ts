import { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from 'convex/server';

type InternalConvexHttpClient = {
  setAdminAuth(token: string): void;
  query<Query extends FunctionReference<'query', 'internal' | 'public'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>>;
  mutation<Mutation extends FunctionReference<'mutation', 'internal' | 'public'>>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>>;
  action<Action extends FunctionReference<'action', 'internal' | 'public'>>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<FunctionReturnType<Action>>;
};

function getRequiredServerEnv(name: 'CONVEX_DEPLOY_KEY' | 'VITE_CONVEX_URL', fallback?: string) {
  const value = fallback ?? process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value.trim();
}

export function createConvexAdminClient(input?: {
  deployKey?: string;
  convexUrl?: string;
}): InternalConvexHttpClient {
  const client = new ConvexHttpClient(getRequiredServerEnv('VITE_CONVEX_URL', input?.convexUrl), {
    logger: false,
  }) as unknown as InternalConvexHttpClient;
  client.setAdminAuth(getRequiredServerEnv('CONVEX_DEPLOY_KEY', input?.deployKey));
  return client;
}
