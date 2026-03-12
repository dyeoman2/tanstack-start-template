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

export type OrganizationDirectorySortField = (typeof ORGANIZATION_DIRECTORY_SORT_FIELDS)[number];
export type OrganizationDirectorySortOrder = 'asc' | 'desc';
export type OrganizationDirectoryKind = (typeof ORGANIZATION_DIRECTORY_KIND_VALUES)[number];
export type OrganizationDirectoryRole = (typeof ORGANIZATION_DIRECTORY_ROLE_VALUES)[number];

export type OrganizationDirectorySearchParams = {
  page: number;
  pageSize: number;
  sortBy: OrganizationDirectorySortField;
  sortOrder: OrganizationDirectorySortOrder;
  secondarySortBy: OrganizationDirectorySortField;
  secondarySortOrder: OrganizationDirectorySortOrder;
  search: string;
  kind: OrganizationDirectoryKind;
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
