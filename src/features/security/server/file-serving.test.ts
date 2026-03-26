import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminMock,
  fetchAuthActionMock,
  getBetterAuthRequestMock,
  resolveRequestAuditContextMock,
  handleServerErrorMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
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
    fileServing: {
      createSignedServeUrl: 'createSignedServeUrl',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAdmin: requireAdminMock,
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

import { createSignedServeUrlServerFn } from './file-serving';

describe('file serving server function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({
      user: {
        id: 'admin_1',
      },
    });
    fetchAuthActionMock.mockResolvedValue({ storageId: 'storage-1', url: 'https://example.com' });
    getBetterAuthRequestMock.mockReturnValue(new Request('https://app.example.com/app/admin'));
    resolveRequestAuditContextMock.mockReturnValue({
      requestId: 'req-123',
      ipAddress: '203.0.113.9',
      userAgent: 'Vitest',
    });
  });

  it('passes request context into signed serve URL creation', async () => {
    await createSignedServeUrlServerFn({
      data: {
        storageId: 'storage-1',
      },
    });

    expect(fetchAuthActionMock).toHaveBeenCalledWith('createSignedServeUrl', {
      storageId: 'storage-1',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });
});
