import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteStorageObjectMock, promoteQuarantineObjectMock, putCleanObjectMock } = vi.hoisted(
  () => ({
    deleteStorageObjectMock: vi.fn(async () => undefined),
    promoteQuarantineObjectMock: vi.fn(async () => ({ VersionId: 'clean-version-1' })),
    putCleanObjectMock: vi.fn(async () => ({ VersionId: 'clean-version-2' })),
  }),
);

vi.mock('../src/lib/server/env.server', () => ({
  getFileStorageBackendMode: vi.fn(() => 's3-primary'),
  getStorageRuntimeConfig: vi.fn(() => ({
    malwareScanSlaMs: 60_000,
    storageBuckets: {
      clean: { bucket: 'clean-bucket', kmsKeyArn: 'clean-kms' },
      mirror: { bucket: 'mirror-bucket', kmsKeyArn: 'mirror-kms' },
      quarantine: { bucket: 'quarantine-bucket', kmsKeyArn: 'quarantine-kms' },
      rejected: { bucket: 'rejected-bucket', kmsKeyArn: 'rejected-kms' },
    },
  })),
}));

vi.mock('./lib/storageS3Control', () => ({
  deleteStorageObject: deleteStorageObjectMock,
  promoteQuarantineObject: promoteQuarantineObjectMock,
  putCleanObject: putCleanObjectMock,
}));

import { storeDerivedFileWithMode } from './storagePlatform';

describe('storeDerivedFileWithMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses explicit validated-clean promotion for trusted parser results', async () => {
    const ctx = {
      runMutation: vi.fn(async () => null),
      runQuery: vi.fn(async () => ({
        malwareStatus: 'CLEAN',
        storageId: 'parent-1',
      })),
      scheduler: {
        runAfter: vi.fn(async () => null),
      },
      storage: {
        store: vi.fn(),
      },
    };

    const result = await storeDerivedFileWithMode(ctx as never, {
      blob: new Blob(['validated result'], { type: 'application/json' }),
      fileName: 'report.pdf.parsed.json',
      mimeType: 'application/json',
      organizationId: 'org_123',
      parentStorageId: 'parent-1',
      sourceId: 'parent-1',
      sourceType: 'pdf_parse_result',
      stagedQuarantineKey: 'quarantine/parser-results/pdf_parse/parent-1.json',
      trustLevel: 'validated_clean',
    });

    expect(result.storageId).toEqual(expect.any(String));
    expect(promoteQuarantineObjectMock).toHaveBeenCalledWith({
      contentType: 'application/json',
      destinationKey: expect.stringMatching(/^clean\/org\/org_123\/pdf_parse_result\//),
      sourceKey: 'quarantine/parser-results/pdf_parse/parent-1.json',
    });
    expect(deleteStorageObjectMock).toHaveBeenCalledWith({
      bucketKind: 'quarantine',
      key: 'quarantine/parser-results/pdf_parse/parent-1.json',
    });
    expect(putCleanObjectMock).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inspectionStatus: 'PASSED',
        malwareStatus: 'CLEAN',
        sourceType: 'pdf_parse_result',
        storagePlacement: 'PROMOTED',
      }),
    );
  });
});
