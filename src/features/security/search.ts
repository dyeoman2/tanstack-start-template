import { z } from 'zod';
import {
  CONTROL_SUPPORT_FILTER_VALUES,
  CONTROL_RESPONSIBILITY_FILTER_VALUES,
  CONTROL_TABLE_SORT_FIELDS,
  FINDING_DISPOSITION_FILTER_VALUES,
  FINDING_FOLLOW_UP_FILTER_VALUES,
  FINDING_SEVERITY_FILTER_VALUES,
  FINDING_STATUS_FILTER_VALUES,
  FINDING_TYPE_FILTER_VALUES,
  POLICY_TABLE_SORT_FIELDS,
  REPORT_KIND_FILTER_VALUES,
  REPORT_REVIEW_STATUS_FILTER_VALUES,
  SECURITY_TABS,
  VENDOR_REVIEW_STATUS_FILTER_VALUES,
} from '~/features/security/constants';

export const securityControlsSearchSchema = z.object({
  sortBy: z.enum(CONTROL_TABLE_SORT_FIELDS).default('control'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  responsibility: z.enum(CONTROL_RESPONSIBILITY_FILTER_VALUES).default('all'),
  support: z.enum(CONTROL_SUPPORT_FILTER_VALUES).default('all'),
  family: z.string().default('all'),
  selectedControl: z.string().optional(),
  showAdvancedFilters: z.boolean().default(false),
});

export const securityPoliciesSearchSchema = z.object({
  policySearch: z.string().default(''),
  policySortBy: z.enum(POLICY_TABLE_SORT_FIELDS).default('title'),
  policySortOrder: z.enum(['asc', 'desc']).default('asc'),
  policySupport: z.enum(CONTROL_SUPPORT_FILTER_VALUES).default('all'),
  selectedPolicy: z.string().optional(),
});

export const securityFindingsSearchSchema = z.object({
  findingDisposition: z.enum(FINDING_DISPOSITION_FILTER_VALUES).default('all'),
  findingFollowUp: z.enum(FINDING_FOLLOW_UP_FILTER_VALUES).default('all'),
  findingSearch: z.string().default(''),
  findingSeverity: z.enum(FINDING_SEVERITY_FILTER_VALUES).default('all'),
  findingStatus: z.enum(FINDING_STATUS_FILTER_VALUES).default('all'),
  findingType: z.enum(FINDING_TYPE_FILTER_VALUES).default('all'),
  selectedFinding: z.string().optional(),
  showAdvancedFilters: z.boolean().default(false),
});

export const securityVendorsSearchSchema = z.object({
  selectedVendor: z.string().optional(),
  vendorReviewStatus: z.enum(VENDOR_REVIEW_STATUS_FILTER_VALUES).default('all'),
  vendorSearch: z.string().default(''),
});

export const securityReviewsSearchSchema = z.object({
  selectedReviewRun: z.string().optional(),
});

export const securityReportsSearchSchema = z.object({
  reportKind: z.enum(REPORT_KIND_FILTER_VALUES).default('all'),
  reportReviewStatus: z.enum(REPORT_REVIEW_STATUS_FILTER_VALUES).default('all'),
  reportSearch: z.string().default(''),
  selectedReport: z.string().optional(),
});

export type SecurityTab = (typeof SECURITY_TABS)[number];
export type SecurityControlsSearch = z.infer<typeof securityControlsSearchSchema>;
export type SecurityPoliciesSearch = z.infer<typeof securityPoliciesSearchSchema>;
export type SecurityFindingsSearch = z.infer<typeof securityFindingsSearchSchema>;
export type SecurityVendorsSearch = z.infer<typeof securityVendorsSearchSchema>;
export type SecurityReviewsSearch = z.infer<typeof securityReviewsSearchSchema>;
export type SecurityReportsSearch = z.infer<typeof securityReportsSearchSchema>;
