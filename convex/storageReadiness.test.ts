import { describe, expect, it } from 'vitest';
import type { Doc } from './_generated/dataModel';
import { getStorageReadiness } from './storageReadiness';

type ReadinessLifecycle = Pick<
  Doc<'storageLifecycle'>,
  | 'backendMode'
  | 'canonicalBucket'
  | 'canonicalKey'
  | 'deletedAt'
  | 'malwareStatus'
  | 'mirrorStatus'
  | 'storagePlacement'
>;

function createLifecycle(overrides: Partial<ReadinessLifecycle>): ReadinessLifecycle {
  return {
    backendMode: 's3-primary',
    canonicalBucket: undefined,
    canonicalKey: undefined,
    deletedAt: undefined,
    malwareStatus: 'PENDING',
    mirrorStatus: undefined,
    storagePlacement: 'QUARANTINE',
    ...overrides,
  };
}

describe('getStorageReadiness', () => {
  it('keeps quarantined s3-primary uploads unreadable before promotion', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          malwareStatus: 'PENDING',
          storagePlacement: 'QUARANTINE',
        }),
      ),
    ).toEqual({
      message: 'Stored file is pending malware scan.',
      readable: false,
      reason: 'pending_scan',
    });
  });

  it('treats promoted clean s3-primary uploads as readable', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: 'bucket',
          canonicalKey: 'clean/org/acme/report/file-1',
          malwareStatus: 'CLEAN',
          storagePlacement: 'PROMOTED',
        }),
      ),
    ).toEqual({
      message: null,
      readable: true,
      reason: null,
    });
  });

  it('treats infected uploads as quarantined even if a placement exists', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: 'bucket',
          canonicalKey: 'clean/org/acme/report/file-1',
          malwareStatus: 'INFECTED',
          storagePlacement: 'PROMOTED',
        }),
      ),
    ).toEqual({
      message: 'Stored file is quarantined.',
      readable: false,
      reason: 'quarantined',
    });
  });

  it('fails closed for legacy clean canonical objects by default', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: 'bucket',
          canonicalKey: 'org/acme/report/file-legacy',
          malwareStatus: 'CLEAN',
          storagePlacement: undefined,
        }),
      ),
    ).toEqual({
      message: 'Stored file is pending malware scan.',
      readable: false,
      reason: 'pending_scan',
    });
  });

  it('can temporarily allow legacy clean canonical objects during rollout', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: 'bucket',
          canonicalKey: 'org/acme/report/file-legacy',
          malwareStatus: 'CLEAN',
          storagePlacement: undefined,
        }),
        {
          allowLegacyPrimaryReads: true,
        },
      ),
    ).toEqual({
      message: null,
      readable: true,
      reason: null,
    });
  });

  it('fails closed when a promoted row is missing its canonical clean object', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: undefined,
          canonicalKey: undefined,
          malwareStatus: 'CLEAN',
          storagePlacement: 'PROMOTED',
        }),
      ),
    ).toEqual({
      message: 'Stored file is pending malware scan.',
      readable: false,
      reason: 'pending_scan',
    });
  });
});
