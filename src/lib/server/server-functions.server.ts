// General server functions
import { createServerFn } from '@tanstack/react-start';
import { getEnv } from '~/lib/server/env.server';

// Get environment information for client-side use
export const getEnvironmentInfoServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const env = getEnv();
  return {
    isDevelopment: env.NODE_ENV === 'development',
    nodeEnv: env.NODE_ENV,
  };
});
