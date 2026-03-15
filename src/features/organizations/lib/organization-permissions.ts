export const ORGANIZATION_ROLE_VALUES = ['owner', 'admin', 'member'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLE_VALUES)[number];
export type OrganizationViewerRole = OrganizationRole | 'site-admin' | null;
export type OrganizationAccess = {
  admin: boolean;
  delete: boolean;
  edit: boolean;
  view: boolean;
  siteAdmin: boolean;
};

export const SITE_ADMIN_ORGANIZATION_ACCESS: OrganizationAccess = {
  admin: true,
  delete: true,
  edit: true,
  view: true,
  siteAdmin: true,
};

export const ADMIN_ORGANIZATION_ACCESS: OrganizationAccess = {
  admin: true,
  delete: false,
  edit: true,
  view: true,
  siteAdmin: false,
};

export const VIEW_ORGANIZATION_ACCESS: OrganizationAccess = {
  admin: false,
  delete: false,
  edit: false,
  view: true,
  siteAdmin: false,
};

export const NO_ORGANIZATION_ACCESS: OrganizationAccess = {
  admin: false,
  delete: false,
  edit: false,
  view: false,
  siteAdmin: false,
};

function isOrganizationRole(value: string): value is OrganizationRole {
  return ORGANIZATION_ROLE_VALUES.includes(value as OrganizationRole);
}

export function normalizeOrganizationRole(value: string | undefined): OrganizationRole {
  if (!value || !isOrganizationRole(value)) {
    return 'member';
  }

  return value;
}

export function deriveViewerRole(input: {
  isSiteAdmin: boolean;
  membershipRole?: string | null;
}): OrganizationViewerRole {
  if (input.isSiteAdmin) {
    return 'site-admin';
  }

  if (!input.membershipRole) {
    return null;
  }

  return normalizeOrganizationRole(input.membershipRole);
}

export function canManageOrganization(viewerRole: OrganizationViewerRole) {
  return viewerRole === 'site-admin' || viewerRole === 'owner' || viewerRole === 'admin';
}

export function canViewOrganizationAudit(viewerRole: OrganizationViewerRole) {
  return canManageOrganization(viewerRole);
}

export function canManageDomains(viewerRole: OrganizationViewerRole) {
  return viewerRole === 'site-admin' || viewerRole === 'owner';
}

export function canManageOrganizationPolicies(viewerRole: OrganizationViewerRole) {
  return viewerRole === 'site-admin' || viewerRole === 'owner';
}

export function getOrganizationAccess(viewerRole: OrganizationViewerRole): OrganizationAccess {
  switch (viewerRole) {
    case 'site-admin':
      return SITE_ADMIN_ORGANIZATION_ACCESS;
    case 'owner':
      return ADMIN_ORGANIZATION_ACCESS;
    case 'admin':
      return ADMIN_ORGANIZATION_ACCESS;
    case 'member':
      return VIEW_ORGANIZATION_ACCESS;
    default:
      return NO_ORGANIZATION_ACCESS;
  }
}

export function canDeleteOrganization(viewerRole: OrganizationViewerRole) {
  return viewerRole === 'site-admin' || viewerRole === 'owner';
}

export function getAssignableRoles(
  viewerRole: OrganizationViewerRole,
  currentRole: OrganizationRole,
  ownerCount: number,
): OrganizationRole[] {
  const canAssignOwner = viewerRole === 'site-admin' || viewerRole === 'owner';

  if (currentRole === 'owner') {
    if (!canAssignOwner || ownerCount <= 1) {
      return [];
    }

    return ['owner', 'admin', 'member'];
  }

  if (viewerRole === 'admin') {
    return ['admin', 'member'];
  }

  if (canAssignOwner) {
    return ['owner', 'admin', 'member'];
  }

  return [];
}

export function canChangeMemberRole(
  viewerRole: OrganizationViewerRole,
  targetRole: OrganizationRole,
  availableRoles: OrganizationRole[],
  isSelf: boolean,
) {
  if (!viewerRole || availableRoles.length === 0) {
    return false;
  }

  if (viewerRole !== 'site-admin' && isSelf) {
    return false;
  }

  return targetRole !== 'owner' || viewerRole === 'site-admin' || viewerRole === 'owner';
}

export function canRemoveMember(
  viewerRole: OrganizationViewerRole,
  targetRole: OrganizationRole,
  isSelf: boolean,
  ownerCount: number,
) {
  if (!viewerRole) {
    return false;
  }

  if (viewerRole !== 'site-admin' && isSelf) {
    return false;
  }

  if (targetRole === 'owner') {
    if (viewerRole !== 'site-admin' && viewerRole !== 'owner') {
      return false;
    }

    return ownerCount > 1;
  }

  return viewerRole === 'site-admin' || viewerRole === 'owner' || viewerRole === 'admin';
}
