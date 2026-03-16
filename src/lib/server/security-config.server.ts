const DEFAULT_ATTACHMENT_URL_TTL_MINUTES = 15;
const DEFAULT_DATA_RETENTION_DAYS = 30;
const DEFAULT_QUARANTINE_RETENTION_DAYS = 7;
const DEFAULT_RECENT_STEP_UP_WINDOW_MINUTES = 15;
const DEFAULT_BACKUP_REPORT_RETENTION_DAYS = 30;

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
      DEFAULT_ATTACHMENT_URL_TTL_MINUTES,
    ),
    backupReportRetentionDays: parsePositiveInteger(
      process.env.BACKUP_REPORT_RETENTION_DAYS,
      DEFAULT_BACKUP_REPORT_RETENTION_DAYS,
    ),
    dataRetentionDays: parsePositiveInteger(
      process.env.DATA_RETENTION_DAYS,
      DEFAULT_DATA_RETENTION_DAYS,
    ),
    quarantineRetentionDays: parsePositiveInteger(
      process.env.QUARANTINE_RETENTION_DAYS,
      DEFAULT_QUARANTINE_RETENTION_DAYS,
    ),
    recentStepUpWindowMinutes: parsePositiveInteger(
      process.env.RECENT_STEP_UP_WINDOW_MINUTES,
      DEFAULT_RECENT_STEP_UP_WINDOW_MINUTES,
    ),
  };
}

export function getRecentStepUpWindowMs() {
  return getRetentionPolicyConfig().recentStepUpWindowMinutes * 60 * 1000;
}

