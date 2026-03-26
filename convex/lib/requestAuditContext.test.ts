import { describe, expect, it } from 'vitest';
import { resolveAuditRequestContext } from './requestAuditContext';

describe('resolveAuditRequestContext', () => {
  it('prefers explicit request context over session metadata', () => {
    expect(
      resolveAuditRequestContext({
        requestContext: {
          requestId: 'req-123',
          ipAddress: '203.0.113.9',
          userAgent: 'forwarded-agent',
        },
        session: {
          ipAddress: '198.51.100.5',
          userAgent: 'session-agent',
        },
      }),
    ).toEqual({
      requestId: 'req-123',
      ipAddress: '203.0.113.9',
      userAgent: 'forwarded-agent',
    });
  });

  it('falls back to session metadata when explicit request context is absent', () => {
    expect(
      resolveAuditRequestContext({
        session: {
          ipAddress: '198.51.100.5',
          userAgent: 'session-agent',
        },
      }),
    ).toEqual({
      ipAddress: '198.51.100.5',
      userAgent: 'session-agent',
    });
  });

  it('drops blank values from both sources', () => {
    expect(
      resolveAuditRequestContext({
        requestContext: {
          requestId: ' ',
          ipAddress: '',
          userAgent: null,
        },
        session: {
          ipAddress: ' ',
          userAgent: '',
        },
      }),
    ).toEqual({});
  });
});
