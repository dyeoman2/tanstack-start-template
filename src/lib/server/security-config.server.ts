import { REGULATED_RETENTION_DEFAULTS } from '../shared/security-baseline';

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export type RetentionPolicyConfig = {
  attachmentUrlTtlMinutes: number;
  backupReportRetentionDays: number;
  dataRetentionDays: number;
  quarantineRetentionDays: number;
  recentStepUpWindowMinutes: number;
};

export function getRetentionPolicyConfig(): RetentionPolicyConfig {
  return {
    attachmentUrlTtlMinutes: parsePositiveInteger(
      process.env.ATTACHMENT_URL_TTL_MINUTES,
      REGULATED_RETENTION_DEFAULTS.attachmentUrlTtlMinutes,
    ),
    backupReportRetentionDays: parsePositiveInteger(
      process.env.BACKUP_REPORT_RETENTION_DAYS,
      REGULATED_RETENTION_DEFAULTS.backupReportRetentionDays,
    ),
    dataRetentionDays: parsePositiveInteger(
      process.env.DATA_RETENTION_DAYS,
      REGULATED_RETENTION_DEFAULTS.dataRetentionDays,
    ),
    quarantineRetentionDays: parsePositiveInteger(
      process.env.QUARANTINE_RETENTION_DAYS,
      REGULATED_RETENTION_DEFAULTS.quarantineRetentionDays,
    ),
    recentStepUpWindowMinutes: parsePositiveInteger(
      process.env.RECENT_STEP_UP_WINDOW_MINUTES,
      REGULATED_RETENTION_DEFAULTS.recentStepUpWindowMinutes,
    ),
  };
}

export function getRecentStepUpWindowMs() {
  return getRetentionPolicyConfig().recentStepUpWindowMinutes * 60 * 1000;
}
