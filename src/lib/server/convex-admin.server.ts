import { ConvexHttpClient } from 'convex/browser';

function getRequiredServerEnv(name: 'VITE_CONVEX_URL') {
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
