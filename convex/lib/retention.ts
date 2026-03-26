export const ORGANIZATION_LEGAL_HOLD_STATUS_VALUES = ['active', 'released'] as const;
export type OrganizationLegalHoldStatus = (typeof ORGANIZATION_LEGAL_HOLD_STATUS_VALUES)[number];

export const RETENTION_DELETION_JOB_KIND_VALUES = ['temporary_artifact_purge'] as const;
export type RetentionDeletionJobKind = (typeof RETENTION_DELETION_JOB_KIND_VALUES)[number];

export const RETENTION_EVENT_TYPES = {
  holdApplied: 'retention_hold_applied',
  holdReleased: 'retention_hold_released',
  purgeCompleted: 'retention_purge_completed',
  purgeFailed: 'retention_purge_failed',
  purgeSkippedOnHold: 'retention_purge_skipped_on_hold',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function getTemporaryArtifactRetentionMs(dataRetentionDays: number) {
  return Math.max(1, Math.floor(dataRetentionDays)) * DAY_MS;
}

export function getTemporaryArtifactPurgeEligibleAt(args: {
  createdAt: number;
  dataRetentionDays: number;
}) {
  return args.createdAt + getTemporaryArtifactRetentionMs(args.dataRetentionDays);
}

export function chooseEarlierPurgeEligibleAt(
  left: number | null | undefined,
  right: number | null | undefined,
) {
  if (left === null || left === undefined) {
    return right ?? undefined;
  }
  if (right === null || right === undefined) {
    return left;
  }
  return Math.min(left, right);
}
