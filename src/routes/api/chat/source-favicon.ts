import { Buffer } from 'node:buffer';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';

const sourceFaviconQuerySchema = z.object({
  hostname: z.string().trim().min(1),
});

export const Route = createFileRoute('/api/chat/source-favicon' as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const parsed = sourceFaviconQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams.entries()),
        );
        if (!parsed.success) {
          return new Response('Not found', { status: 404 });
        }

        try {
          const result = await convexAuthReactStart.fetchAuthAction(
            api.agentChat.fetchSourceFavicon,
            {
              hostname: parsed.data.hostname,
            },
          );
          if (!result.ok) {
            return new Response('Not found', { status: 404 });
          }

          return new Response(Buffer.from(result.bodyBase64, 'base64'), {
            status: 200,
            headers: {
              'cache-control': result.cacheControl,
              'content-type': result.contentType,
            },
          });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      },
    },
  },
});
