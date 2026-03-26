import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

function getRequiredServerEnv(name: 'CONVEX_DEPLOY_KEY' | 'VITE_CONVEX_URL') {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required`);
  }

  return value.trim();
}

export function createConvexPublicClient() {
  return new ConvexHttpClient(getRequiredServerEnv('VITE_CONVEX_URL'), {
    logger: false,
  });
}

function configureAdminAuth(client: ConvexHttpClient) {
  const setAdminAuth = Reflect.get(client, 'setAdminAuth');
  if (typeof setAdminAuth !== 'function') {
    throw new Error('Convex admin auth is unavailable in this runtime');
  }

  Reflect.apply(setAdminAuth, client, [getRequiredServerEnv('CONVEX_DEPLOY_KEY')]);
}

export async function runConvexAdminMutation(path: string, args: Record<string, unknown>) {
  const client = createConvexPublicClient();
  configureAdminAuth(client);
  return await client.mutation(
    makeFunctionReference<'mutation', Record<string, unknown>, unknown>(path),
    args,
  );
}
