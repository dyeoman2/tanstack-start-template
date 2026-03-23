export const SECURITY_TABS = [
  'overview',
  'policies',
  'controls',
  'vendors',
  'findings',
  'reports',
  'reviews',
] as const;
export const SECURITY_TAB_PATHS = {
  overview: '/app/admin/security',
  policies: '/app/admin/security/policies',
  controls: '/app/admin/security/controls',
  vendors: '/app/admin/security/vendors',
  findings: '/app/admin/security/findings',
  reports: '/app/admin/security/reports',
  reviews: '/app/admin/security/reviews',
} as const;

export const CONTROL_TABLE_SORT_FIELDS = [
  'control',
  'support',
  'responsibility',
  'family',
] as const;

export const POLICY_TABLE_SORT_FIELDS = [
  'title',
  'support',
  'owner',
  'mappedControlCount',
  'nextReviewAt',
] as const;

export const CONTROL_RESPONSIBILITY_FILTER_VALUES = [
  'all',
  'platform',
  'shared-responsibility',
  'customer',
] as const;

export const CONTROL_SUPPORT_FILTER_VALUES = ['all', 'complete', 'partial', 'missing'] as const;
export const EVIDENCE_REVIEW_DUE_OPTIONS = [3, 6, 12] as const;
export const EVIDENCE_SOURCE_OPTIONS = [
  'manual_upload',
  'internal_review',
  'automated_system_check',
  'external_report',
  'vendor_attestation',
] as const;
export const EVIDENCE_SUFFICIENCY_OPTIONS = ['missing', 'partial', 'sufficient'] as const;
