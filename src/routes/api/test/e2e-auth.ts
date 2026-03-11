import { api } from '@convex/_generated/api';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import {
  assertE2EAuthRequestAuthorized,
  getPlaywrightCookiesFromResponse,
} from '~/lib/server/e2e-auth.server';
import {
  getE2EPrincipalConfig,
  getE2ETestSecret,
  type E2EPrincipalType,
} from '~/lib/server/env.server';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';

const principalSchema = z.object({
  principal: z.enum(['user', 'admin']),
});

type AuthRouteResponse = {
  code?: string;
  message?: string;
};

async function readAuthError(response: Response): Promise<AuthRouteResponse> {
  try {
    return (await response.json()) as AuthRouteResponse;
  } catch {
    const message = await response.text();
    return { message };
  }
}

async function postToAuthEndpoint(
  request: Request,
  path: '/api/auth/sign-in/email' | '/api/auth/sign-up/email',
  principal: ReturnType<typeof getE2EPrincipalConfig>,
) {
  const url = new URL(path, request.url);
  const body =
    path === '/api/auth/sign-up/email'
      ? {
          email: principal.email,
          password: principal.password,
          name: principal.name,
          rememberMe: true,
        }
      : {
          email: principal.email,
          password: principal.password,
          rememberMe: true,
        };

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function establishPrincipalSession(request: Request, principalType: E2EPrincipalType) {
  const principal = getE2EPrincipalConfig(principalType);
  const secret = getE2ETestSecret();

  let authResponse = await postToAuthEndpoint(request, '/api/auth/sign-in/email', principal);

  if (!authResponse.ok) {
    await convexAuthReactStart.fetchAuthMutation(api.e2e.resetPrincipalByEmail, {
      secret,
      email: principal.email,
    });

    authResponse = await postToAuthEndpoint(request, '/api/auth/sign-up/email', principal);

    if (!authResponse.ok) {
      const authError = await readAuthError(authResponse);
      throw new Response(authError.message || 'Failed to provision e2e principal', {
        status: authResponse.status,
      });
    }
  }

  const roleResult = await convexAuthReactStart.fetchAuthMutation(api.e2e.ensurePrincipalRole, {
    secret,
    email: principal.email,
    role: principal.role,
  });

  if (!roleResult.found) {
    throw new Response('Failed to reconcile e2e principal role', { status: 500 });
  }

  const cookies = getPlaywrightCookiesFromResponse(authResponse, new URL(request.url).origin);

  if (cookies.length === 0) {
    throw new Response('No auth cookies were issued for e2e principal', { status: 500 });
  }

  return {
    cookies,
    email: principal.email,
    principal: principal.role,
    userId: roleResult.userId,
  };
}

export const Route = createFileRoute('/api/test/e2e-auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        assertE2EAuthRequestAuthorized(request);

        const body = principalSchema.safeParse(await request.json());
        if (!body.success) {
          return new Response(body.error.message, { status: 400 });
        }

        const response = await establishPrincipalSession(request, body.data.principal);
        return Response.json(response);
      },
    },
  },
});
