import type { Doc } from './_generated/dataModel';

type StorageLifecycleLike = Pick<
  Doc<'storageLifecycle'>,
  | 'backendMode'
  | 'canonicalBucket'
  | 'canonicalKey'
  | 'deletedAt'
  | 'inspectionStatus'
  | 'malwareStatus'
  | 'mirrorStatus'
  | 'storagePlacement'
> | null;

export type StorageReadiness =
  | {
      message: null;
      readable: true;
      reason: null;
    }
  | {
      message: string;
      readable: false;
      reason: 'deleted' | 'mirror_pending' | 'not_found' | 'pending_scan' | 'quarantined';
    };

export function getStorageReadiness(lifecycle: StorageLifecycleLike): StorageReadiness {
  if (!lifecycle || lifecycle.deletedAt) {
    return {
      message: 'Stored file not found.',
      readable: false,
      reason: lifecycle?.deletedAt ? 'deleted' : 'not_found',
    };
  }

  if (lifecycle.backendMode === 'convex') {
    return {
      message: null,
      readable: true,
      reason: null,
    };
  }

  if (
    lifecycle.inspectionStatus === 'REJECTED' ||
    lifecycle.inspectionStatus === 'FAILED' ||
    lifecycle.malwareStatus === 'INFECTED' ||
    lifecycle.malwareStatus === 'QUARANTINED_UNSCANNED'
  ) {
    return {
      message: 'Stored file is quarantined.',
      readable: false,
      reason: 'quarantined',
    };
  }

  if (
    lifecycle.backendMode === 's3-primary' &&
    (lifecycle.storagePlacement === 'QUARANTINE' ||
      lifecycle.storagePlacement === 'REJECTED' ||
      lifecycle.storagePlacement === undefined ||
      (lifecycle.storagePlacement === 'PROMOTED' &&
        (!lifecycle.canonicalBucket || !lifecycle.canonicalKey)))
  ) {
    return {
      message: 'Stored file is pending malware scan.',
      readable: false,
      reason: 'pending_scan',
    };
  }

  if (lifecycle.inspectionStatus !== undefined && lifecycle.inspectionStatus !== 'PASSED') {
    return {
      message: 'Stored file is pending security review.',
      readable: false,
      reason: 'pending_scan',
    };
  }

  if (lifecycle.malwareStatus !== 'CLEAN') {
    return {
      message: 'Stored file is pending malware scan.',
      readable: false,
      reason: 'pending_scan',
    };
  }

  if (lifecycle.backendMode === 's3-mirror' && lifecycle.mirrorStatus !== 'MIRRORED') {
    return {
      message: 'Stored file is waiting for secure mirror finalization.',
      readable: false,
      reason: 'mirror_pending',
    };
  }

  return {
    message: null,
    readable: true,
    reason: null,
  };
}
