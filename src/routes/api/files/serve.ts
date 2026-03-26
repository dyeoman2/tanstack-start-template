import { createFileRoute } from '@tanstack/react-router';
import { deriveConvexSiteUrl, normalizeUrlOrigin } from '~/lib/convex-url';
import { buildBetterAuthProxyHeaders } from '~/lib/server/better-auth/http';

function resolveConvexHttpOrigin(): string | undefined {
  const cloudUrl = process.env.VITE_CONVEX_URL?.trim().replace(/\/$/, '');
  if (!cloudUrl) {
    return undefined;
  }

  return cloudUrl.includes('://') ? deriveConvexSiteUrl(cloudUrl) : normalizeUrlOrigin(cloudUrl);
}

export async function proxyFileServeRequest(request: Request): Promise<Response> {
  const convexHttpOrigin = resolveConvexHttpOrigin();
  if (!convexHttpOrigin) {
    return new Response('File redemption is unavailable.', { status: 503 });
  }

  const target = new URL(request.url);
  const targetPath = `${target.pathname}${target.search}`;
  const headers = await buildBetterAuthProxyHeaders(request, {
    targetPath,
  });

  return await fetch(new URL(targetPath, convexHttpOrigin), {
    headers,
    method: 'GET',
    redirect: 'manual',
  });
}

export const Route = createFileRoute('/api/files/serve')({
  server: {
    handlers: {
      GET: async ({ request }) => await proxyFileServeRequest(request),
    },
  },
});
