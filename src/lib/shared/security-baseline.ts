export const REGULATED_RETENTION_DEFAULTS = {
  attachmentUrlTtlMinutes: 15,
  backupReportRetentionDays: 30,
  dataRetentionDays: 30,
  exportPayloadRetentionHours: 24,
  quarantineRetentionDays: 7,
  recentStepUpWindowMinutes: 15,
} as const;

export const ALWAYS_ON_REGULATED_BASELINE = {
  auditExportRequiresStepUp: true,
  requireVerifiedEmail: true,
  requireMfaOrPasskey: true,
  allowBreakGlassPasswordLogin: false,
  webSearchAllowed: false,
  aiChatEnabled: true,
} as const;

export const REGULATED_ORGANIZATION_POLICY_DEFAULTS = {
  invitePolicy: 'owners_admins',
  verifiedDomainsOnly: false,
  memberCap: null,
  mfaRequired: ALWAYS_ON_REGULATED_BASELINE.requireMfaOrPasskey,
  auditExportRequiresStepUp: ALWAYS_ON_REGULATED_BASELINE.auditExportRequiresStepUp,
  attachmentSharingAllowed: false,
  dataRetentionDays: REGULATED_RETENTION_DEFAULTS.dataRetentionDays,
  enterpriseAuthMode: 'off',
  enterpriseProviderKey: null,
  enterpriseProtocol: null,
  enterpriseEnabledAt: null,
  enterpriseEnforcedAt: null,
  allowBreakGlassPasswordLogin: ALWAYS_ON_REGULATED_BASELINE.allowBreakGlassPasswordLogin,
  temporaryLinkTtlMinutes: REGULATED_RETENTION_DEFAULTS.attachmentUrlTtlMinutes,
  supportAccessApprovalModel: 'single_owner',
  supportAccessEnabled: true,
  webSearchAllowed: ALWAYS_ON_REGULATED_BASELINE.webSearchAllowed,
  aiChatEnabled: ALWAYS_ON_REGULATED_BASELINE.aiChatEnabled,
} as const;

export type RegulatedOrganizationPolicies = {
  allowBreakGlassPasswordLogin: boolean;
  attachmentSharingAllowed: boolean;
  auditExportRequiresStepUp: boolean;
  dataRetentionDays: number;
  enterpriseAuthMode: 'off' | 'optional' | 'required';
  enterpriseEnabledAt: number | null;
  enterpriseEnforcedAt: number | null;
  enterpriseProtocol: 'oidc' | null;
  enterpriseProviderKey: 'google-workspace' | 'entra' | 'okta' | null;
  invitePolicy: 'owners_admins' | 'owners_only';
  memberCap: number | null;
  mfaRequired: boolean;
  supportAccessApprovalModel: 'single_owner';
  supportAccessEnabled: boolean;
  temporaryLinkTtlMinutes: number;
  verifiedDomainsOnly: boolean;
  webSearchAllowed: boolean;
  aiChatEnabled: boolean;
};

export function applyAlwaysOnRegulatedBaseline<T extends RegulatedOrganizationPolicies>(
  policies: T,
): T {
  return {
    ...policies,
    mfaRequired: ALWAYS_ON_REGULATED_BASELINE.requireMfaOrPasskey,
    auditExportRequiresStepUp: ALWAYS_ON_REGULATED_BASELINE.auditExportRequiresStepUp,
    allowBreakGlassPasswordLogin: ALWAYS_ON_REGULATED_BASELINE.allowBreakGlassPasswordLogin,
  };
}
