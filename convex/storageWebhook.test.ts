import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGuardDutyFinding } from './storageWebhook';

const { getStorageRuntimeConfigMock, promoteS3PrimaryObjectMock } = vi.hoisted(() => ({
  getStorageRuntimeConfigMock: vi.fn(() => ({
    malwareWebhookSharedSecret: 'secret',
    s3FilesBucket: 'bucket',
  })),
  promoteS3PrimaryObjectMock: vi.fn(),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: getStorageRuntimeConfigMock,
}));

vi.mock('./storageS3Primary', async () => {
  const actual = await vi.importActual<typeof import('./storageS3Primary')>('./storageS3Primary');
  return {
    ...actual,
    promoteS3PrimaryObject: promoteS3PrimaryObjectMock,
  };
});

describe('applyGuardDutyFinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses promotion for clean s3-primary findings and treats repeat promotion as idempotent', async () => {
    promoteS3PrimaryObjectMock.mockResolvedValue({
      promoted: false,
      reason: 'already_promoted',
    });

    const ctx = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      runQuery: vi.fn(async () => ({
        backendMode: 's3-primary',
        malwareFindingId: undefined,
        storageId: 'file-1',
      })),
    };

    await expect(
      applyGuardDutyFinding(ctx as never, {
        bucket: 'bucket',
        findingId: 'finding-1',
        key: 'quarantine/org/acme/chat/file-1',
        scannedAt: Date.now(),
        status: 'CLEAN',
      }),
    ).resolves.toEqual({
      applied: false,
      reason: 'already_promoted',
    });

    expect(promoteS3PrimaryObjectMock).toHaveBeenCalledWith(ctx, {
      scannedAt: expect.any(Number),
      storageId: 'file-1',
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
