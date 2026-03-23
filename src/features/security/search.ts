import { z } from 'zod';
import {
  CONTROL_SUPPORT_FILTER_VALUES,
  CONTROL_RESPONSIBILITY_FILTER_VALUES,
  CONTROL_TABLE_SORT_FIELDS,
  SECURITY_TABS,
} from '~/features/security/constants';

export const securityCompatSearchSchema = z.object({
  tab: z.enum(SECURITY_TABS).optional(),
  page: z.number().optional(),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
  sortBy: z.enum(CONTROL_TABLE_SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
  responsibility: z.enum(CONTROL_RESPONSIBILITY_FILTER_VALUES).optional(),
  support: z.enum(CONTROL_SUPPORT_FILTER_VALUES).optional(),
  family: z.string().optional(),
  selectedControl: z.string().optional(),
  selectedPolicy: z.string().optional(),
  selectedOperationId: z.string().optional(),
  selectedOperationType: z
    .enum(['evidence_report', 'finding', 'vendor_review', 'review_run'])
    .optional(),
});

export const securityControlsSearchSchema = z.object({
  page: z.number().default(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(10),
  sortBy: z.enum(CONTROL_TABLE_SORT_FIELDS).default('control'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  responsibility: z.enum(CONTROL_RESPONSIBILITY_FILTER_VALUES).default('all'),
  support: z.enum(CONTROL_SUPPORT_FILTER_VALUES).default('all'),
  family: z.string().default('all'),
  selectedControl: z.string().optional(),
});

export const securityPoliciesSearchSchema = z.object({
  selectedPolicy: z.string().optional(),
});

export const securityOperationsSearchSchema = z.object({
  selectedOperationId: z.string().optional(),
  selectedOperationType: z
    .enum(['evidence_report', 'finding', 'vendor_review', 'review_run'])
    .optional(),
});

export const securityReviewsSearchSchema = z.object({});

export type SecurityTab = (typeof SECURITY_TABS)[number];
export type SecurityCompatSearch = z.infer<typeof securityCompatSearchSchema>;
export type SecurityControlsSearch = z.infer<typeof securityControlsSearchSchema>;
export type SecurityPoliciesSearch = z.infer<typeof securityPoliciesSearchSchema>;
export type SecurityOperationsSearch = z.infer<typeof securityOperationsSearchSchema>;
export type SecurityReviewsSearch = z.infer<typeof securityReviewsSearchSchema>;
