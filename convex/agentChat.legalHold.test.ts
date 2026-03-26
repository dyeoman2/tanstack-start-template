import { beforeEach, describe, expect, it, vi } from 'vitest';

const getVerifiedCurrentUserOrThrowMock = vi.fn();
const recordUserAuditEventMock = vi.fn();
const requireThreadPermissionMock = vi.fn();

vi.mock('./_generated/server', () => ({
  action: (config: unknown) => config,
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  mutation: (config: unknown) => config,
  query: (config: unknown) => config,
}));

vi.mock('./_generated/api', () => ({
  components: {
    agent: {
      threads: {
        deleteAllForThreadIdAsync: 'components.agent.threads.deleteAllForThreadIdAsync',
      },
    },
  },
  internal: {
    agentChat: {
      patchThreadInternal: 'internal.agentChat.patchThreadInternal',
    },
    retention: {
      assertOrganizationHoldAllowsOperationInternal:
        'internal.retention.assertOrganizationHoldAllowsOperationInternal',
    },
  },
}));

vi.mock('./auth/access', () => ({
  getVerifiedCurrentUserOrThrow: (...args: unknown[]) => getVerifiedCurrentUserOrThrowMock(...args),
  requireOrganizationPermission: vi.fn(),
  requireThreadPermission: (...args: unknown[]) => requireThreadPermissionMock(...args),
}));

vi.mock('./lib/auditEmitters', () => ({
  recordUserAuditEvent: (...args: unknown[]) => recordUserAuditEventMock(...args),
}));

describe('agent chat legal hold enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVerifiedCurrentUserOrThrowMock.mockResolvedValue({
      _id: 'viewer-1',
      activeOrganizationId: 'org_1',
      authUser: {
        email: 'clinician@hospital.org',
        name: 'Clinician',
      },
      isSiteAdmin: false,
    });
    requireThreadPermissionMock.mockResolvedValue({
      thread: {
        _id: 'thread-1',
        organizationId: 'org_1',
        title: 'Lab review',
      },
    });
  });

  it('blocks user thread deletion when a legal hold is active', async () => {
    const agentChatModule = await import('./agentChat');
    const handler = (agentChatModule.deleteThread as any).handler as (
      ctx: unknown,
      args: Record<string, unknown>,
    ) => Promise<null>;
    const runQuery = vi.fn(async () => {
      throw new Error('Organization legal hold is active. Chat deletion is blocked.');
    });
    const runMutation = vi.fn();

    await expect(
      handler(
        {
          auth: {
            getUserIdentity: vi.fn().mockResolvedValue({
              sessionId: 'session-1',
            }),
          },
          runMutation,
          runQuery,
        } as never,
        {
          threadId: 'thread-1',
        },
      ),
    ).rejects.toThrow('Organization legal hold is active. Chat deletion is blocked.');

    expect(runQuery).toHaveBeenCalledWith(
      'internal.retention.assertOrganizationHoldAllowsOperationInternal',
      {
        operation: 'delete',
        organizationId: 'org_1',
        resourceId: 'thread-1',
        resourceType: 'chat_thread',
      },
    );
    expect(runMutation).not.toHaveBeenCalled();
    expect(recordUserAuditEventMock).not.toHaveBeenCalled();
  });

  it('blocks cleanup thread deletion when a legal hold is active', async () => {
    const agentChatModule = await import('./agentChat');
    const handler = (agentChatModule.deleteThreadForCleanupInternal as any).handler as (
      ctx: unknown,
      args: Record<string, unknown>,
    ) => Promise<null>;

    await expect(
      handler(
        {
          db: {
            get: vi.fn().mockResolvedValue({
              _id: 'thread-1',
              organizationId: 'org_1',
              agentThreadId: 'agent-thread-1',
            }),
          },
          runQuery: vi.fn(async () => {
            throw new Error('Organization legal hold is active. Cleanup is blocked.');
          }),
        } as never,
        {
          threadId: 'thread-1',
        },
      ),
    ).rejects.toThrow('Organization legal hold is active. Cleanup is blocked.');
  });
});
