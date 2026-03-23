import { z } from 'zod';
import {
  CONTROL_SUPPORT_FILTER_VALUES,
  CONTROL_RESPONSIBILITY_FILTER_VALUES,
  CONTROL_TABLE_SORT_FIELDS,
  SECURITY_TABS,
} from '~/features/security/constants';

export const securitySearchSchema = z.object({
  tab: z.enum(SECURITY_TABS).default('overview'),
  page: z.number().default(1),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(10),
  sortBy: z.enum(CONTROL_TABLE_SORT_FIELDS).default('control'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  responsibility: z.enum(CONTROL_RESPONSIBILITY_FILTER_VALUES).default('all'),
  support: z.enum(CONTROL_SUPPORT_FILTER_VALUES).default('all'),
  family: z.string().default('all'),
  selectedControl: z.string().optional(),
  selectedOperationId: z.string().optional(),
  selectedOperationType: z
    .enum(['evidence_report', 'finding', 'vendor_review', 'review_run'])
    .optional(),
});

export type SecuritySearch = z.infer<typeof securitySearchSchema>;
