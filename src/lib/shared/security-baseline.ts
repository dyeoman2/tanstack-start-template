export const REGULATED_RETENTION_DEFAULTS = {
  attachmentUrlTtlMinutes: 15,
  backupReportRetentionDays: 30,
  dataRetentionDays: 30,
  quarantineRetentionDays: 7,
  recentStepUpWindowMinutes: 15,
} as const;

export const REGULATED_ORGANIZATION_POLICY_DEFAULTS = {
  invitePolicy: 'owners_admins',
  verifiedDomainsOnly: false,
  memberCap: null,
  mfaRequired: true,
  auditExportRequiresStepUp: true,
  attachmentSharingAllowed: false,
  dataRetentionDays: REGULATED_RETENTION_DEFAULTS.dataRetentionDays,
  enterpriseAuthMode: 'off',
  enterpriseProviderKey: null,
  enterpriseProtocol: null,
  enterpriseEnabledAt: null,
  enterpriseEnforcedAt: null,
  allowBreakGlassPasswordLogin: false,
  temporaryLinkTtlMinutes: REGULATED_RETENTION_DEFAULTS.attachmentUrlTtlMinutes,
  webSearchAllowed: false,
} as const;
