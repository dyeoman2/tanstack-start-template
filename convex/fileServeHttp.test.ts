import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_PROXY_IP_HEADER,
  AUTH_PROXY_IP_SIGNATURE_HEADER,
  AUTH_PROXY_IP_TIMESTAMP_HEADER,
  buildBetterAuthProxyHeaders,
} from '../src/lib/server/better-auth/http';

const { createAuthMock } = vi.hoisted(() => ({
  createAuthMock: vi.fn(),
}));

vi.mock('./auth', () => ({
  createAuth: createAuthMock,
}));

import { handleFileServeRequest } from './fileServeHttp';

const ORIGINAL_ENV = { ...process.env };

describe('handleFileServeRequest', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_DEPLOYMENT_ENV: 'development',
      AUTH_PROXY_SHARED_SECRET: 'test-auth-proxy-shared-secret-abcdefghijklmnopqrstuvwxyz',
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete (globalThis as typeof globalThis & { Netlify?: unknown }).Netlify;
  });

  it('passes trusted proxy IP and user agent into successful ticket redemption', async () => {
    (globalThis as typeof globalThis & { Netlify?: { context: { ip: string } } }).Netlify = {
      context: {
        ip: '198.51.100.7',
      },
    };

    const targetPath = '/api/files/serve?ticket=ticket_123&exp=1710000000000&sig=test-signature';
    const sourceRequest = new Request(`https://app.example.com${targetPath}`, {
      headers: {
        cookie: 'session=abc',
        'user-agent': 'Vitest Browser',
        'x-forwarded-for': '203.0.113.9',
        'x-request-id': 'req-123',
      },
      method: 'GET',
    });
    const headers = await buildBetterAuthProxyHeaders(sourceRequest, {
      targetPath,
    });
    headers.set('x-forwarded-for', '203.0.113.10');

    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: {
            id: 'session_1',
            userId: 'user_1',
          },
        }),
      },
    });
    const runAction = vi.fn().mockResolvedValue({
      url: 'https://download.example.test/file',
    });

    const response = await handleFileServeRequest(
      {
        runAction,
        runMutation: vi.fn(),
        runQuery: vi.fn(),
      } as never,
      new Request(`https://deployment.convex.site${targetPath}`, {
        headers,
        method: 'GET',
      }),
    );

    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authenticatedSessionId: 'session_1',
        authenticatedUserId: 'user_1',
        requestIpAddress: '198.51.100.7',
        requestUserAgent: 'Vitest Browser',
        ticketId: 'ticket_123',
      }),
    );
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://download.example.test/file');
  });

  it('drops forged proxy IP headers before recording redemption failures', async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    });
    const runAction = vi.fn().mockResolvedValue(null);

    const response = await handleFileServeRequest(
      {
        runAction,
        runMutation: vi.fn(),
        runQuery: vi.fn(),
      } as never,
      new Request(
        'https://deployment.convex.site/api/files/serve?ticket=ticket_123&exp=1710000000000&sig=test-signature',
        {
          headers: {
            [AUTH_PROXY_IP_HEADER]: '198.51.100.7',
            [AUTH_PROXY_IP_SIGNATURE_HEADER]: 'deadbeef',
            [AUTH_PROXY_IP_TIMESTAMP_HEADER]: `${Date.now()}`,
            'user-agent': 'Attacker Browser',
            'x-forwarded-for': '203.0.113.9',
          },
          method: 'GET',
        },
      ),
    );

    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorMessage: 'Authentication required to redeem a file access ticket.',
        requestIpAddress: null,
        requestUserAgent: 'Attacker Browser',
        ticketId: 'ticket_123',
      }),
    );
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });
});
