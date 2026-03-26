import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_PROXY_IP_HEADER,
  AUTH_PROXY_IP_SIGNATURE_HEADER,
  AUTH_PROXY_IP_TIMESTAMP_HEADER,
  buildBetterAuthProxyHeaders,
  buildTrustedConvexAuthRequest,
  getTrustedClientIp,
} from '~/lib/server/better-auth/http';

const ORIGINAL_ENV = { ...process.env };

describe('better-auth trusted proxy headers', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_DEPLOYMENT_ENV: 'development',
      AUTH_PROXY_SHARED_SECRET: 'test-auth-proxy-shared-secret-abcdefghijklmnopqrstuvwxyz',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete (globalThis as typeof globalThis & { Netlify?: unknown }).Netlify;
  });

  it('builds sanitized proxy headers and signs canonical client ip from Netlify metadata', async () => {
    (globalThis as typeof globalThis & { Netlify?: { context: { ip: string } } }).Netlify = {
      context: {
        ip: '198.51.100.7',
      },
    };

    const request = new Request('https://app.example.com/api/auth/sign-in/email', {
      headers: {
        cookie: 'session=abc',
        origin: 'https://app.example.com',
        referer: 'https://app.example.com/login',
        'user-agent': 'Vitest',
        'x-request-id': 'req-123',
        'x-forwarded-for': '203.0.113.9',
        'x-real-ip': '198.51.100.4',
      },
      method: 'POST',
    });

    const headers = await buildBetterAuthProxyHeaders(request);

    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-request-id')).toBe('req-123');
    expect(headers.get(AUTH_PROXY_IP_HEADER)).toBe('198.51.100.7');
    expect(headers.get(AUTH_PROXY_IP_TIMESTAMP_HEADER)).toMatch(/^\d+$/u);
    expect(headers.get(AUTH_PROXY_IP_SIGNATURE_HEADER)).toMatch(/^[a-f0-9]{64}$/u);
    expect(headers.has('x-forwarded-for')).toBe(false);
    expect(headers.has('x-real-ip')).toBe(false);
  });

  it('omits canonical ip headers when platform-native client ip is unavailable', async () => {
    const request = new Request('https://app.example.com/api/auth/sign-in/email', {
      headers: {
        cookie: 'session=abc',
        origin: 'https://app.example.com',
        referer: 'https://app.example.com/login',
      },
      method: 'POST',
    });

    const headers = await buildBetterAuthProxyHeaders(request);

    expect(headers.get(AUTH_PROXY_IP_HEADER)).toBeNull();
    expect(headers.get(AUTH_PROXY_IP_SIGNATURE_HEADER)).toBeNull();
    expect(headers.get(AUTH_PROXY_IP_TIMESTAMP_HEADER)).toBeNull();
  });

  it('preserves canonical ip only when the proxy signature verifies', async () => {
    (globalThis as typeof globalThis & { Netlify?: { context: { ip: string } } }).Netlify = {
      context: {
        ip: '198.51.100.7',
      },
    };

    const sourceRequest = new Request('https://app.example.com/api/auth/sign-in/email?next=/app', {
      headers: {
        cookie: 'session=abc',
        origin: 'https://app.example.com',
        referer: 'https://app.example.com/login',
        'user-agent': 'Vitest',
      },
      method: 'POST',
    });

    const signedHeaders = await buildBetterAuthProxyHeaders(sourceRequest);
    signedHeaders.set('x-forwarded-for', '203.0.113.9');
    signedHeaders.set('x-real-ip', '203.0.113.10');

    const trustedRequest = await buildTrustedConvexAuthRequest(
      new Request('https://deployment.convex.site/api/auth/sign-in/email?next=/app', {
        body: JSON.stringify({ email: 'user@example.com' }),
        headers: signedHeaders,
        method: 'POST',
      }),
    );

    expect(getTrustedClientIp(trustedRequest)).toBe('198.51.100.7');
    expect(trustedRequest.headers.get(AUTH_PROXY_IP_SIGNATURE_HEADER)).toBeNull();
    expect(trustedRequest.headers.get(AUTH_PROXY_IP_TIMESTAMP_HEADER)).toBeNull();
    expect(trustedRequest.headers.get('x-forwarded-for')).toBeNull();
    expect(trustedRequest.headers.get('x-real-ip')).toBeNull();
  });

  it('strips canonical ip headers when the proxy signature is forged', async () => {
    const request = await buildTrustedConvexAuthRequest(
      new Request('https://deployment.convex.site/api/auth/sign-in/email', {
        body: JSON.stringify({ email: 'user@example.com' }),
        headers: {
          [AUTH_PROXY_IP_HEADER]: '198.51.100.7',
          [AUTH_PROXY_IP_SIGNATURE_HEADER]: 'deadbeef',
          [AUTH_PROXY_IP_TIMESTAMP_HEADER]: `${Date.now()}`,
          'user-agent': 'Vitest',
          'x-forwarded-for': '203.0.113.9',
        },
        method: 'POST',
      }),
    );

    expect(getTrustedClientIp(request)).toBe('203.0.113.9');
    expect(request.headers.get('x-forwarded-for')).toBeNull();
  });

  it('falls back to forwarded proxy headers when no signed canonical ip is present', async () => {
    const request = await buildTrustedConvexAuthRequest(
      new Request('https://deployment.convex.site/api/auth/get-session', {
        headers: {
          'cf-connecting-ip': '198.51.100.8',
          'user-agent': 'Vitest',
          'x-forwarded-for': '203.0.113.9, 198.51.100.2',
        },
        method: 'GET',
      }),
    );

    expect(getTrustedClientIp(request)).toBe('198.51.100.8');
    expect(request.headers.get('cf-connecting-ip')).toBeNull();
    expect(request.headers.get('x-forwarded-for')).toBeNull();
  });

  it('uses a loopback ip in development when Convex does not provide a client ip', async () => {
    const request = await buildTrustedConvexAuthRequest(
      new Request('https://deployment.convex.site/api/auth/get-session', {
        headers: {
          'user-agent': 'Vitest',
        },
        method: 'GET',
      }),
    );

    expect(getTrustedClientIp(request)).toBe('127.0.0.1');
  });
});
