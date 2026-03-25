import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_generated/server', () => ({
  internalAction: (config: unknown) => config,
  internalMutation: (config: unknown) => config,
  internalQuery: (config: unknown) => config,
  mutation: (config: unknown) => config,
}));

vi.mock('./_generated/api', () => ({
  internal: {
    securityOps: {
      deleteSecurityWorkspaceTableBatchForDevelopment:
        'deleteSecurityWorkspaceTableBatchForDevelopment',
    },
  },
}));

vi.mock('./auth/access', () => ({
  getVerifiedCurrentUserOrThrow: vi.fn(),
  requireOrganizationPermission: vi.fn(),
}));

vi.mock('./lib/security/core', () => ({
  getSecurityScopeFields: vi.fn(),
}));

vi.mock('./lib/security/operations_core', () => ({
  documentScanEventArgs: {},
  recordBackupVerificationHandler: vi.fn(),
  syncCurrentSecurityFindings: vi.fn(),
  updateSecurityMetrics: vi.fn(),
}));

vi.mock('./lib/security/validators', () => ({
  backupVerificationDrillTypeValidator: {},
  backupVerificationInitiatedByKindValidator: {},
  backupVerificationTargetEnvironmentValidator: {},
}));

vi.mock('../src/lib/shared/compliance/control-register', () => ({
  ACTIVE_CONTROL_REGISTER: {
    controls: [{ id: 'control-1' }, { id: 'control-2' }],
  },
}));

const ORIGINAL_ENV = { ...process.env };

describe('securityOps reset guards', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      APP_DEPLOYMENT_ENV: 'development',
      ENABLE_SECURITY_WORKSPACE_RESET: 'true',
      SECURITY_WORKSPACE_RESET_SECRET: 'reset-secret',
      E2E_TEST_SECRET: 'e2e-secret',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('rejects the shared e2e auth secret for destructive reset batches', async () => {
    const module = await import('./securityOps');
    const handler = (
      module.deleteSecurityWorkspaceTableBatchForDevelopment as unknown as {
        handler: (
          ctx: {
            db: {
              delete: (id: string) => Promise<void>;
              query: (table: string) => { take: (size: number) => Promise<Array<{ _id: string }>> };
            };
          },
          args: { secret: string; tableName: 'securityControlEvidence' },
        ) => Promise<unknown>;
      }
    ).handler;

    await expect(
      handler(
        {
          db: {
            delete: vi.fn(async () => {}),
            query: () => ({
              take: async () => [],
            }),
          },
        },
        {
          secret: 'e2e-secret',
          tableName: 'securityControlEvidence',
        },
      ),
    ).rejects.toThrow('Invalid reseed secret.');
  });

  it('accepts only the reset-specific secret for destructive reset batches', async () => {
    const module = await import('./securityOps');
    const deleteFn = vi.fn(async () => {});
    const handler = (
      module.deleteSecurityWorkspaceTableBatchForDevelopment as unknown as {
        handler: (
          ctx: {
            db: {
              delete: (id: string) => Promise<void>;
              query: (table: string) => { take: (size: number) => Promise<Array<{ _id: string }>> };
            };
          },
          args: { secret: string; tableName: 'securityControlEvidence' },
        ) => Promise<{ deletedCount: number; hasMore: boolean }>;
      }
    ).handler;

    const result = await handler(
      {
        db: {
          delete: deleteFn,
          query: () => ({
            take: async () => [{ _id: 'evidence-1' }],
          }),
        },
      },
      {
        secret: 'reset-secret',
        tableName: 'securityControlEvidence',
      },
    );

    expect(deleteFn).toHaveBeenCalledWith('evidence-1');
    expect(result).toEqual({
      deletedCount: 1,
      hasMore: false,
    });
  });

  it('rejects destructive reset outside explicit development or test deployments', async () => {
    process.env.APP_DEPLOYMENT_ENV = 'preview';
    const module = await import('./securityOps');
    const runMutation = vi.fn();
    const handler = (
      module.resetSecurityControlWorkspaceForDevelopment as unknown as {
        handler: (
          ctx: {
            runMutation: (
              ref: unknown,
              args: { secret: string; tableName: string },
            ) => Promise<{ deletedCount: number; hasMore: boolean }>;
          },
          args: { secret: string },
        ) => Promise<unknown>;
      }
    ).handler;

    await expect(
      handler(
        {
          runMutation,
        },
        {
          secret: 'reset-secret',
        },
      ),
    ).rejects.toThrow('Security workspace reset is disabled.');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('passes the reset-specific secret through the reseed action', async () => {
    const module = await import('./securityOps');
    const runMutation = vi.fn(async () => ({
      deletedCount: 0,
      hasMore: false,
    }));
    const handler = (
      module.resetSecurityControlWorkspaceForDevelopment as unknown as {
        handler: (
          ctx: {
            runMutation: (
              ref: unknown,
              args: { secret: string; tableName: string },
            ) => Promise<{ deletedCount: number; hasMore: boolean }>;
          },
          args: { secret: string },
        ) => Promise<{ activeSeedControlCount: number }>;
      }
    ).handler;

    const result = await handler(
      {
        runMutation,
      },
      {
        secret: 'reset-secret',
      },
    );

    expect(runMutation).toHaveBeenCalled();
    const forwardedArgs = runMutation.mock.calls as unknown as Array<[unknown, { secret: string }]>;
    for (const [, args] of forwardedArgs) {
      expect(args).toMatchObject({ secret: 'reset-secret' });
    }
    expect(result.activeSeedControlCount).toBe(2);
  });
});
