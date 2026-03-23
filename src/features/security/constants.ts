export const SECURITY_TABS = ['overview', 'controls', 'operations', 'reviews'] as const;

export const CONTROL_TABLE_SORT_FIELDS = [
  'control',
  'evidence',
  'responsibility',
  'family',
] as const;

export const CONTROL_RESPONSIBILITY_FILTER_VALUES = [
  'all',
  'platform',
  'shared-responsibility',
  'customer',
] as const;

export const CONTROL_EVIDENCE_FILTER_VALUES = ['all', 'ready', 'partial', 'missing'] as const;

export const CONTROL_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const EVIDENCE_REVIEW_DUE_OPTIONS = [3, 6, 12] as const;
export const EVIDENCE_SOURCE_OPTIONS = [
  'manual_upload',
  'internal_review',
  'automated_system_check',
  'external_report',
  'vendor_attestation',
] as const;
export const EVIDENCE_SUFFICIENCY_OPTIONS = ['missing', 'partial', 'sufficient'] as const;
