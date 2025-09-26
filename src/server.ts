import { createStartHandler, defaultRenderHandler } from '@tanstack/react-start/server';

// Database connection is now handled with lazy initialization via db proxy
// No need to initialize on server startup as the proxy handles this automatically

const handler = createStartHandler(async ({ request, router, responseHeaders }) => {
  return defaultRenderHandler({ request, router, responseHeaders });
});

export default {
  async fetch(req: Request): Promise<Response> {
    return await handler(req);
  },
};
