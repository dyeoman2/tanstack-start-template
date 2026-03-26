import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAuthMock,
  fetchAuthActionMock,
  getBetterAuthRequestMock,
  resolveRequestAuditContextMock,
  handleServerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  fetchAuthActionMock: vi.fn(),
  getBetterAuthRequestMock: vi.fn(),
  resolveRequestAuditContextMock: vi.fn(),
  handleServerErrorMock: vi.fn((error: unknown) => error),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator() {
      return this;
    },
    handler: (handler: (...args: unknown[]) => unknown) => handler,
  }),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    organizationDomains: {
      verifyOrganizationDomain: 'verifyOrganizationDomain',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
  },
}));

vi.mock('~/lib/server/better-auth/http', () => ({
  getBetterAuthRequest: getBetterAuthRequestMock,
}));

vi.mock('~/lib/server/request-audit-context', () => ({
  resolveRequestAuditContext: resolveRequestAuditContextMock,
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  handleServerError: handleServerErrorMock,
}));

import { verifyOrganizationDomainServerFn } from './organization-domains';

describe('organization domains server function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      user: {
        id: 'user_1',
      },
    });
    fetchAuthActionMock.mockResolvedValue({ verified: true });
    getBetterAuthRequestMock.mockReturnValue(new Request('https://app.example.com/app'));
    resolveRequestAuditContextMock.mockReturnValue({
      requestId: 'req-123',
      ipAddress: '203.0.113.9',
      userAgent: 'Vitest',
    });
  });

  it('passes request context into domain verification actions', async () => {
    await verifyOrganizationDomainServerFn({
      data: {
        organizationId: 'org-1',
        domainId: 'domain-1',
      },
    });

    expect(fetchAuthActionMock).toHaveBeenCalledWith('verifyOrganizationDomain', {
      organizationId: 'org-1',
      domainId: 'domain-1',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });
});
