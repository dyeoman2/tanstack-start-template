import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGuardDutyFinding, applyGuardDutyPromotionResult } from './storageWebhook';

const { getStorageRuntimeConfigMock } = vi.hoisted(() => ({
  getStorageRuntimeConfigMock: vi.fn(() => ({
    malwareWebhookSharedSecret: 'secret',
    s3FilesBucket: 'bucket',
  })),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: getStorageRuntimeConfigMock,
}));

describe('storage webhook handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records clean s3-primary findings and waits for the decision worker', async () => {
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
      applied: true,
      reason: 'ok',
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scannedAt: expect.any(Number),
        storageId: 'file-1',
      }),
    );
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('treats repeat promotion callbacks as idempotent', async () => {
    const ctx = {
      runAction: vi.fn(),
      runMutation: vi.fn(),
      runQuery: vi.fn(async (_ref: unknown, args: { key: string }) => {
        if (args.key === 'quarantine/org/acme/chat/file-1') {
          return {
            canonicalBucket: 'bucket',
            canonicalKey: 'clean/org/acme/chat/file-1',
            canonicalVersionId: 'version-1',
            malwareStatus: 'CLEAN',
            storageId: 'file-1',
            storagePlacement: 'PROMOTED',
          };
        }
        return null;
      }),
    };

    await expect(
      applyGuardDutyPromotionResult(ctx as never, {
        bucket: 'bucket',
        findingId: 'finding-1',
        promotedBucket: 'bucket',
        promotedKey: 'clean/org/acme/chat/file-1',
        promotedVersionId: 'version-1',
        quarantineKey: 'quarantine/org/acme/chat/file-1',
        scannedAt: Date.now(),
        status: 'PROMOTED',
      }),
    ).resolves.toEqual({
      applied: false,
      reason: 'already_promoted',
    });

    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});
