import { describe, expect, it } from 'vitest';
import type { Doc } from './_generated/dataModel';
import { getStorageReadiness } from './storageReadiness';

type ReadinessLifecycle = Pick<
  Doc<'storageLifecycle'>,
  | 'backendMode'
  | 'canonicalBucket'
  | 'canonicalKey'
  | 'deletedAt'
  | 'inspectionStatus'
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
    inspectionStatus: 'PENDING',
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
          inspectionStatus: 'PENDING',
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
          inspectionStatus: 'PASSED',
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
          inspectionStatus: 'PASSED',
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

  it('fails closed when a promoted row is missing its canonical clean object', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: undefined,
          canonicalKey: undefined,
          inspectionStatus: 'PASSED',
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

  it('keeps malware-clean files unreadable until inspection passes', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: undefined,
          canonicalKey: undefined,
          inspectionStatus: 'PENDING',
          malwareStatus: 'CLEAN',
          storagePlacement: 'QUARANTINE',
        }),
      ),
    ).toEqual({
      message: 'Stored file is pending malware scan.',
      readable: false,
      reason: 'pending_scan',
    });
  });

  it('treats inspection-rejected uploads as quarantined', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          inspectionStatus: 'REJECTED',
          malwareStatus: 'PENDING',
          storagePlacement: 'REJECTED',
        }),
      ),
    ).toEqual({
      message: 'Stored file is quarantined.',
      readable: false,
      reason: 'quarantined',
    });
  });

  it('keeps legacy promoted clean rows readable while inspection status is missing', () => {
    expect(
      getStorageReadiness(
        createLifecycle({
          canonicalBucket: 'bucket',
          canonicalKey: 'clean/org/acme/report/file-1',
          inspectionStatus: undefined,
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
});
