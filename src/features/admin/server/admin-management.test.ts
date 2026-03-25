import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchAuthActionMock,
  fetchAuthMutationMock,
  handleServerErrorMock,
  listBetterAuthUserSessionsMock,
  requireAdminMock,
} = vi.hoisted(() => ({
  fetchAuthActionMock: vi.fn(),
  fetchAuthMutationMock: vi.fn(),
  handleServerErrorMock: vi.fn((error: unknown) => error),
  listBetterAuthUserSessionsMock: vi.fn(),
  requireAdminMock: vi.fn(),
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
    admin: {
      deleteUserIndexEntry: 'deleteUserIndexEntry',
      setUserOnboardingStatus: 'setUserOnboardingStatus',
      syncUserIndexEntry: 'syncUserIndexEntry',
    },
    audit: {
      recordAuditEventFromServer: 'recordAuditEventFromServer',
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
    fetchAuthQuery: vi.fn(),
  },
}));

vi.mock('~/lib/server/env.server', () => ({
  getAuditServerWriteSecret: vi.fn(() => 'test-audit-server-write-secret'),
}));

vi.mock('~/lib/server/error-utils.server', () => ({
  ServerError: class ServerError extends Error {
    statusCode: number;
    payload: unknown;

    constructor(message: string, statusCode: number, payload?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.payload = payload;
    }
  },
  handleServerError: handleServerErrorMock,
}));

vi.mock('~/lib/server/better-auth/http', () => ({
  getBetterAuthRequest: vi.fn(),
}));

vi.mock('~/lib/server/better-auth/api', () => ({
  banBetterAuthUser: vi.fn(),
  createBetterAuthUser: vi.fn(),
  getBetterAuthUser: vi.fn(),
  listBetterAuthUserSessions: listBetterAuthUserSessionsMock,
  listBetterAuthUsers: vi.fn(),
  removeBetterAuthUser: vi.fn(),
  requestBetterAuthPasswordReset: vi.fn(),
  revokeBetterAuthUserSession: vi.fn(),
  revokeBetterAuthUserSessions: vi.fn(),
  setBetterAuthUserPassword: vi.fn(),
  setBetterAuthUserRole: vi.fn(),
  unbanBetterAuthUser: vi.fn(),
  updateBetterAuthUser: vi.fn(),
}));

import { listAdminUserSessionsServerFn } from './admin-management';

describe('listAdminUserSessionsServerFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the audit event through the trusted server audit action', async () => {
    requireAdminMock.mockResolvedValue({
      user: {
        id: 'admin_1',
      },
    });
    listBetterAuthUserSessionsMock.mockResolvedValue({
      sessions: [
        {
          id: 'session_1',
          userId: 'user_1',
          expiresAt: 1_710_000_000_000,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_705_000_000_000,
          ipAddress: null,
          userAgent: null,
          impersonatedBy: undefined,
        },
      ],
    });

    const result = await listAdminUserSessionsServerFn({
      data: {
        userId: 'user_1',
      },
    });

    expect(listBetterAuthUserSessionsMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(fetchAuthActionMock).toHaveBeenCalledWith('recordAuditEventFromServer', {
      serverWriteSecret: 'test-audit-server-write-secret',
      eventType: 'admin_user_sessions_viewed',
      metadata: JSON.stringify({
        targetUserId: 'user_1',
        sessionCount: 1,
      }),
      outcome: 'success',
      resourceId: 'user_1',
      resourceType: 'user_session',
      severity: 'info',
      sourceSurface: 'admin.user_sessions',
    });
    expect(result).toEqual([
      {
        id: 'session_1',
        userId: 'user_1',
        expiresAt: 1_710_000_000_000,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_705_000_000_000,
        ipAddress: null,
        userAgent: null,
        impersonatedBy: undefined,
      },
    ]);
  });
});
