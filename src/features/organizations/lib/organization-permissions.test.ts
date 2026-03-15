import { describe, expect, it } from 'vitest';
import {
  canDeleteOrganization,
  canChangeMemberRole,
  canManageDomains,
  canManageOrganization,
  canRemoveMember,
  canViewOrganizationAudit,
  deriveViewerRole,
  getAssignableRoles,
  getOrganizationAccess,
} from './organization-permissions';

describe('organization permission rules', () => {
  it('derives site admin as the highest viewer role', () => {
    expect(
      deriveViewerRole({
        isSiteAdmin: true,
        membershipRole: 'member',
      }),
    ).toBe('site-admin');
  });

  it('allows owners, admins, and site admins to manage organizations', () => {
    expect(canManageOrganization('site-admin')).toBe(true);
    expect(canManageOrganization('owner')).toBe(true);
    expect(canManageOrganization('admin')).toBe(true);
    expect(canManageOrganization('member')).toBe(false);
    expect(canManageOrganization(null)).toBe(false);
  });

  it('maps viewer roles to a single canonical access model', () => {
    expect(getOrganizationAccess('site-admin')).toMatchObject({
      admin: true,
      delete: true,
      edit: true,
      view: true,
      siteAdmin: true,
    });
    expect(getOrganizationAccess('owner')).toMatchObject({
      admin: true,
      delete: false,
      edit: true,
      view: true,
      siteAdmin: false,
    });
    expect(getOrganizationAccess('admin')).toMatchObject({
      admin: true,
      delete: false,
      edit: true,
      view: true,
      siteAdmin: false,
    });
    expect(getOrganizationAccess('member')).toMatchObject({
      admin: false,
      edit: false,
      view: true,
    });
    expect(getOrganizationAccess(null)).toMatchObject({
      admin: false,
      edit: false,
      view: false,
    });
  });

  it('lets owners and site admins assign owner roles, but not admins', () => {
    expect(getAssignableRoles('site-admin', 'member', 2)).toEqual(['owner', 'admin', 'member']);
    expect(getAssignableRoles('owner', 'member', 2)).toEqual(['owner', 'admin', 'member']);
    expect(getAssignableRoles('admin', 'member', 2)).toEqual(['admin', 'member']);
  });

  it('restricts organization deletion to owners and site admins', () => {
    expect(canDeleteOrganization('site-admin')).toBe(true);
    expect(canDeleteOrganization('owner')).toBe(true);
    expect(canDeleteOrganization('admin')).toBe(false);
    expect(canDeleteOrganization('member')).toBe(false);
    expect(canDeleteOrganization(null)).toBe(false);
  });

  it('keeps domain management owner-only while allowing audit for admins', () => {
    expect(canManageDomains('site-admin')).toBe(true);
    expect(canManageDomains('owner')).toBe(true);
    expect(canManageDomains('admin')).toBe(false);
    expect(canManageDomains('member')).toBe(false);
    expect(canViewOrganizationAudit('site-admin')).toBe(true);
    expect(canViewOrganizationAudit('owner')).toBe(true);
    expect(canViewOrganizationAudit('admin')).toBe(true);
    expect(canViewOrganizationAudit('member')).toBe(false);
  });

  it('prevents demoting or removing the last owner', () => {
    const ownerRoles = getAssignableRoles('owner', 'owner', 1);
    expect(ownerRoles).toEqual([]);
    expect(canRemoveMember('owner', 'owner', false, 1)).toBe(false);
    expect(canChangeMemberRole('owner', 'owner', ownerRoles, false)).toBe(false);
  });

  it('prevents non-site-admins from changing their own role or removing themselves', () => {
    const adminAssignableRoles = getAssignableRoles('admin', 'member', 2);
    expect(canChangeMemberRole('admin', 'member', adminAssignableRoles, true)).toBe(false);
    expect(canRemoveMember('admin', 'member', true, 2)).toBe(false);
    expect(canChangeMemberRole('site-admin', 'member', adminAssignableRoles, true)).toBe(true);
    expect(canRemoveMember('site-admin', 'member', true, 2)).toBe(true);
  });

  it('prevents org admins from modifying owners', () => {
    const adminAssignableOwnerRoles = getAssignableRoles('admin', 'owner', 2);
    expect(adminAssignableOwnerRoles).toEqual([]);
    expect(canChangeMemberRole('admin', 'owner', adminAssignableOwnerRoles, false)).toBe(false);
    expect(canRemoveMember('admin', 'owner', false, 2)).toBe(false);
  });
});
