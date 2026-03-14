import { z } from 'zod';

export const ORGANIZATION_DIRECTORY_SORT_FIELDS = [
  'name',
  'email',
  'kind',
  'role',
  'status',
  'createdAt',
] as const;

export const ORGANIZATION_DIRECTORY_KIND_VALUES = ['all', 'member', 'invite'] as const;
export const ORGANIZATION_DIRECTORY_ROLE_VALUES = ['owner', 'admin', 'member'] as const;

export const organizationDirectorySearchSchema = z.object({
  page: z.number().default(1),
  pageSize: z.number().default(10),
  sortBy: z.enum(ORGANIZATION_DIRECTORY_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  secondarySortBy: z.enum(ORGANIZATION_DIRECTORY_SORT_FIELDS).default('email'),
  secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().default(''),
  kind: z.enum(ORGANIZATION_DIRECTORY_KIND_VALUES).default('all'),
});

export type OrganizationDirectorySortField = (typeof ORGANIZATION_DIRECTORY_SORT_FIELDS)[number];
export type OrganizationDirectorySortOrder = 'asc' | 'desc';
export type OrganizationDirectoryKind = (typeof ORGANIZATION_DIRECTORY_KIND_VALUES)[number];
export type OrganizationDirectoryRole = (typeof ORGANIZATION_DIRECTORY_ROLE_VALUES)[number];

export type OrganizationDirectorySearchParams = z.infer<typeof organizationDirectorySearchSchema>;

export type OrganizationCreationEligibility = {
  count: number;
  limit: number | null;
  canCreate: boolean;
  reason: string | null;
  isUnlimited: boolean;
};

export type OrganizationMemberRow = {
  id: string;
  kind: 'member';
  membershipId: string;
  authUserId: string;
  name: string | null;
  email: string;
  role: OrganizationDirectoryRole;
  status: 'active';
  createdAt: number;
  isSiteAdmin: boolean;
  availableRoles: OrganizationDirectoryRole[];
  canChangeRole: boolean;
  canRemove: boolean;
};

export type OrganizationInvitationRow = {
  id: string;
  kind: 'invite';
  invitationId: string;
  name: null;
  email: string;
  role: Extract<OrganizationDirectoryRole, 'admin' | 'member'>;
  status: 'pending' | 'expired';
  createdAt: number;
  expiresAt: number;
  canRevoke: boolean;
};

export type OrganizationDirectoryRow = OrganizationMemberRow | OrganizationInvitationRow;
