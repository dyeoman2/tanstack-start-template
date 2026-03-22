import { createServerFn } from '@tanstack/react-start';
import { getRequiredBetterAuthUrl } from '~/lib/server/env.server';

export const getBetterAuthRuntimeConfigServerFn = createServerFn({
  method: 'GET',
}).handler(() => {
  return {
    canonicalOrigin: getRequiredBetterAuthUrl(),
  };
});
