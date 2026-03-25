import { v } from 'convex/values';

export const ORGANIZATION_PERMISSION_VALUES = [
  'viewOrganization',
  'manageMembers',
  'manageDomains',
  'managePolicies',
  'viewAudit',
  'exportAudit',
  'manageEvidence',
  'readThread',
  'writeThread',
  'readAttachment',
  'deleteAttachment',
  'issueAttachmentAccessUrl',
] as const;

export type OrganizationPermission = (typeof ORGANIZATION_PERMISSION_VALUES)[number];

export const organizationPermissionValidator = v.union(
  ...ORGANIZATION_PERMISSION_VALUES.map((permission) => v.literal(permission)),
);

export const ORGANIZATION_ENTERPRISE_DATA_PLANE_PERMISSION_VALUES = [
  'readThread',
  'writeThread',
  'readAttachment',
  'deleteAttachment',
  'issueAttachmentAccessUrl',
] as const satisfies readonly OrganizationPermission[];

export const ORGANIZATION_OWNER_BREAK_GLASS_PERMISSION_VALUES = [
  'viewOrganization',
  'manageMembers',
  'manageDomains',
  'managePolicies',
] as const satisfies readonly OrganizationPermission[];

export const ORGANIZATION_SUPPORT_ACCESS_READ_ONLY_PERMISSION_VALUES = [
  'viewOrganization',
  'viewAudit',
  'exportAudit',
  'readThread',
  'readAttachment',
  'issueAttachmentAccessUrl',
] as const satisfies readonly OrganizationPermission[];

const ORGANIZATION_PERMISSION_SET = new Set<string>(ORGANIZATION_PERMISSION_VALUES);
const ENTERPRISE_DATA_PLANE_PERMISSION_SET = new Set<string>(
  ORGANIZATION_ENTERPRISE_DATA_PLANE_PERMISSION_VALUES,
);
const OWNER_BREAK_GLASS_PERMISSION_SET = new Set<string>(
  ORGANIZATION_OWNER_BREAK_GLASS_PERMISSION_VALUES,
);
const SUPPORT_ACCESS_READ_ONLY_PERMISSION_SET = new Set<string>(
  ORGANIZATION_SUPPORT_ACCESS_READ_ONLY_PERMISSION_VALUES,
);

export function requiresEnterpriseSatisfied(permission?: string | null) {
  if (!permission) {
    return true;
  }

  return ORGANIZATION_PERMISSION_SET.has(permission);
}

export function isEnterpriseDataPlanePermission(permission?: string | null) {
  if (!permission) {
    return false;
  }

  return ENTERPRISE_DATA_PLANE_PERMISSION_SET.has(permission);
}

export function canOwnerUseBreakGlassForPermission(permission?: string | null) {
  if (!permission) {
    return false;
  }

  return OWNER_BREAK_GLASS_PERMISSION_SET.has(permission);
}

export function doesSupportGrantCoverPermission(
  scope: 'read_only' | 'read_write',
  permission?: string | null,
) {
  if (!permission || !ORGANIZATION_PERMISSION_SET.has(permission)) {
    return false;
  }

  if (scope === 'read_write') {
    return true;
  }

  return SUPPORT_ACCESS_READ_ONLY_PERMISSION_SET.has(permission);
}
