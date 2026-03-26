import { describe, expect, it, vi } from 'vitest';
import { AUTH_PROXY_IP_HEADER } from '~/lib/server/better-auth/http';
import { resolveRequestAuditContext } from '~/lib/server/request-audit-context';

describe('resolveRequestAuditContext', () => {
  it('reads the canonical trusted proxy ip header and preserves an inbound request id', () => {
    const request = new Request('https://app.example.com/app', {
      headers: {
        [AUTH_PROXY_IP_HEADER]: '203.0.113.9',
        'user-agent': 'Vitest',
        'x-request-id': 'req-123',
      },
    });

    expect(resolveRequestAuditContext(request)).toEqual({
      requestId: 'req-123',
      ipAddress: '203.0.113.9',
      userAgent: 'Vitest',
    });
  });

  it('ignores raw forwarded headers when the canonical proxy header is absent', () => {
    const request = new Request('https://app.example.com/app', {
      headers: {
        'cf-connecting-ip': '198.51.100.5',
        'x-forwarded-for': '203.0.113.9, 198.51.100.2',
      },
    });

    expect(resolveRequestAuditContext(request)).toEqual({
      requestId: expect.any(String),
      ipAddress: null,
      userAgent: null,
    });
  });

  it('generates a request id when the request is missing one', () => {
    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('12345678-1234-1234-1234-123456789abc');
    const request = new Request('https://app.example.com/app');

    expect(resolveRequestAuditContext(request)).toEqual({
      requestId: '12345678-1234-1234-1234-123456789abc',
      ipAddress: null,
      userAgent: null,
    });

    randomUuidSpy.mockRestore();
  });
});
