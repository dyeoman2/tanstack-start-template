import { describe, expect, it } from 'vitest';
import { buildBetterAuthForwardHeaders } from '~/lib/server/better-auth/http';

describe('buildBetterAuthForwardHeaders', () => {
  it('forwards only the trusted Better Auth proxy headers', () => {
    const request = new Request('https://app.example.com/app', {
      headers: {
        cookie: 'session=abc',
        origin: 'https://app.example.com',
        referer: 'https://app.example.com/app',
        'user-agent': 'Vitest',
        'x-forwarded-for': '203.0.113.9',
        'x-forwarded-host': 'app.example.com',
        'x-forwarded-proto': 'https',
        'x-real-ip': '198.51.100.4',
        'cf-connecting-ip': '198.51.100.5',
      },
    });

    const headers = buildBetterAuthForwardHeaders(request);

    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(headers.get('x-forwarded-host')).toBe('app.example.com');
    expect(headers.get('x-forwarded-proto')).toBe('https');
    expect(headers.has('x-real-ip')).toBe(false);
    expect(headers.has('cf-connecting-ip')).toBe(false);
  });
});
