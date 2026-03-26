import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminMock,
  fetchAuthActionMock,
  fetchAuthMutationMock,
  getBetterAuthRequestMock,
  resolveRequestAuditContextMock,
  handleServerErrorMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  fetchAuthActionMock: vi.fn(),
  fetchAuthMutationMock: vi.fn(),
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
    securityReports: {
      exportEvidenceReport: 'exportEvidenceReport',
      generateEvidenceReport: 'generateEvidenceReport',
      reviewEvidenceReport: 'reviewEvidenceReport',
    },
  },
}));

vi.mock('~/features/auth/server/auth-guards', () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthAction: fetchAuthActionMock,
    fetchAuthMutation: fetchAuthMutationMock,
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

import {
  exportEvidenceReportServerFn,
  generateEvidenceReportServerFn,
  reviewEvidenceReportServerFn,
} from './security-reports';

describe('security report server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({
      user: {
        id: 'admin_1',
      },
    });
    getBetterAuthRequestMock.mockReturnValue(new Request('https://app.example.com/app/admin'));
    resolveRequestAuditContextMock.mockReturnValue({
      requestId: 'req-123',
      ipAddress: '203.0.113.9',
      userAgent: 'Vitest',
    });
  });

  it('passes request context into review report mutations', async () => {
    fetchAuthMutationMock.mockResolvedValue({ ok: true });

    await reviewEvidenceReportServerFn({
      data: {
        id: 'report-1',
        internalNotes: 'needs review',
        reviewStatus: 'reviewed',
      },
    });

    expect(fetchAuthMutationMock).toHaveBeenCalledWith('reviewEvidenceReport', {
      id: 'report-1',
      internalNotes: 'needs review',
      reviewStatus: 'reviewed',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });

  it('passes request context into report actions', async () => {
    fetchAuthActionMock.mockResolvedValue({ id: 'report-1', report: '{}' });

    await generateEvidenceReportServerFn({
      data: {
        reportKind: 'audit_readiness',
      },
    });

    await exportEvidenceReportServerFn({
      data: {
        id: 'report-1',
      },
    });

    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(1, 'generateEvidenceReport', {
      reportKind: 'audit_readiness',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
    expect(fetchAuthActionMock).toHaveBeenNthCalledWith(2, 'exportEvidenceReport', {
      id: 'report-1',
      requestContext: {
        requestId: 'req-123',
        ipAddress: '203.0.113.9',
        userAgent: 'Vitest',
      },
    });
  });
});
