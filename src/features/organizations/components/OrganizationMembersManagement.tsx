import { api } from '@convex/_generated/api';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { Card, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { OrganizationMembersTable } from '~/features/organizations/components/OrganizationMembersTable';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import type {
  OrganizationDirectoryKind,
  OrganizationDirectoryRole,
  OrganizationDirectoryRow,
  OrganizationDirectorySearchParams,
} from '~/features/organizations/lib/organization-management';

const KIND_FILTER_OPTIONS: TableFilterOption<OrganizationDirectoryKind>[] = [
  { label: 'All rows', value: 'all' },
  { label: 'Members', value: 'member' },
  { label: 'Invites', value: 'invite' },
];

export function OrganizationMembersManagement({
  searchParams,
  slug,
}: {
  searchParams: OrganizationDirectorySearchParams;
  slug: string;
}) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const directory = useQuery(api.organizationManagement.listOrganizationDirectory, {
    slug,
    ...searchParams,
  });
  const createInvitation = useMutation(api.organizationManagement.createOrganizationInvitation);
  const updateMemberRole = useMutation(api.organizationManagement.updateOrganizationMemberRole);
  const removeMember = useMutation(api.organizationManagement.removeOrganizationMember);
  const cancelInvitation = useMutation(api.organizationManagement.cancelOrganizationInvitation);

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedRoleMember, setSelectedRoleMember] = useState<Extract<
    OrganizationDirectoryRow,
    { kind: 'member' }
  > | null>(null);
  const [selectedRemovalMember, setSelectedRemovalMember] = useState<Extract<
    OrganizationDirectoryRow,
    { kind: 'member' }
  > | null>(null);
  const [selectedInvitation, setSelectedInvitation] = useState<Extract<
    OrganizationDirectoryRow,
    { kind: 'invite' }
  > | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isRemovingMember, setIsRemovingMember] = useState(false);
  const [isRevokingInvitation, setIsRevokingInvitation] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [nextRole, setNextRole] = useState<OrganizationDirectoryRole>('member');
  const [roleError, setRoleError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedRoleMember) {
      return;
    }

    setNextRole(selectedRoleMember.role);
    setRoleError(null);
  }, [selectedRoleMember]);

  const isLoading = directory === undefined;
  const rows = directory?.rows ?? [];
  const pagination = directory?.pagination ?? {
    page: searchParams.page,
    pageSize: searchParams.pageSize,
    total: 0,
    totalPages: 0,
  };
  const canManage =
    directory?.access.siteAdmin ||
    directory?.viewerRole === 'owner' ||
    directory?.viewerRole === 'admin';
  const organizationName = directory?.organization.name ?? 'Organization';
  const handleSearchChange = (search: string) => {
    void navigate({
      to: '/app/organizations/$slug/members',
      params: { slug },
      search: {
        ...searchParams,
        page: 1,
        search,
      },
    });
  };

  const handleKindChange = (kind: OrganizationDirectoryKind) => {
    void navigate({
      to: '/app/organizations/$slug/members',
      params: { slug },
      search: {
        ...searchParams,
        kind,
        page: 1,
      },
    });
  };

  const handleInviteSubmit = async () => {
    if (!directory) {
      return;
    }

    setIsInviting(true);
    setInviteError(null);

    try {
      await createInvitation({
        organizationId: directory.organization.id,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteDialogOpen(false);
      setInviteEmail('');
      setInviteRole('member');
      showToast('Invitation sent.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to invite member';
      setInviteError(message);
      showToast(message, 'error');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleSubmit = async () => {
    if (!directory || !selectedRoleMember) {
      return;
    }

    setIsUpdatingRole(true);
    setRoleError(null);

    try {
      await updateMemberRole({
        organizationId: directory.organization.id,
        membershipId: selectedRoleMember.membershipId,
        role: nextRole,
      });
      setSelectedRoleMember(null);
      showToast('Member role updated.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update member role';
      setRoleError(message);
      showToast(message, 'error');
    } finally {
      setIsUpdatingRole(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!directory || !selectedRemovalMember) {
      return;
    }

    setIsRemovingMember(true);
    setRemoveError(null);

    try {
      await removeMember({
        organizationId: directory.organization.id,
        membershipId: selectedRemovalMember.membershipId,
      });
      setSelectedRemovalMember(null);
      showToast('Member removed.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove member';
      setRemoveError(message);
      showToast(message, 'error');
    } finally {
      setIsRemovingMember(false);
    }
  };

  const handleRevokeInvitation = async () => {
    if (!directory || !selectedInvitation) {
      return;
    }

    setIsRevokingInvitation(true);
    setRevokeError(null);

    try {
      await cancelInvitation({
        organizationId: directory.organization.id,
        invitationId: selectedInvitation.invitationId,
      });
      setSelectedInvitation(null);
      showToast('Invitation revoked.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke invitation';
      setRevokeError(message);
      showToast(message, 'error');
    } finally {
      setIsRevokingInvitation(false);
    }
  };

  const handleResendInvitation = async (
    invitation: Extract<OrganizationDirectoryRow, { kind: 'invite' }>,
  ) => {
    if (!directory) {
      return;
    }

    setIsInviting(true);
    setInviteError(null);

    try {
      await createInvitation({
        organizationId: directory.organization.id,
        email: invitation.email,
        role: invitation.role,
      });
      showToast('Invitation resent.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resend invitation';
      setInviteError(message);
      showToast(message, 'error');
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopyInvitationLink = async (
    invitation: Extract<OrganizationDirectoryRow, { kind: 'invite' }>,
  ) => {
    try {
      const inviteLink = `${window.location.origin}/invite/${invitation.invitationId}`;
      await navigator.clipboard.writeText(inviteLink);
      showToast('Invite link copied.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to copy invite link';
      showToast(message, 'error');
    }
  };

  const availableRoles = useMemo(
    () => selectedRoleMember?.availableRoles ?? [],
    [selectedRoleMember],
  );

  if (!isLoading && !directory) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization not found</CardTitle>
          <CardDescription>
            The requested organization is unavailable or you no longer have access to it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OrganizationWorkspaceNav
        slug={slug}
        view="MEMBERS"
        title={organizationName}
        description="Manage members and invitations with one org-specific directory."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setInviteDialogOpen(true)}>
              <Plus className="size-4" />
              Invite member
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard label="Members" value={directory?.counts.members ?? 0} />
        <SummaryCard label="Pending invites" value={directory?.counts.invites ?? 0} />
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TableFilter<OrganizationDirectoryKind>
            label="Type"
            value={searchParams.kind}
            options={KIND_FILTER_OPTIONS}
            onValueChange={handleKindChange}
            className="sm:w-44"
            ariaLabel="Filter organization rows by type"
          />
          <TableSearch
            initialValue={searchParams.search}
            onSearch={handleSearchChange}
            placeholder="Search by name or email"
            className="min-w-[260px] sm:max-w-lg"
            ariaLabel="Search organization members and invitations"
          />
        </div>

        <OrganizationMembersTable
          slug={slug}
          rows={rows}
          pagination={pagination}
          searchParams={searchParams}
          isLoading={isLoading}
          onChangeRole={(row) => {
            setSelectedRoleMember(row);
            setRoleError(null);
          }}
          onRemoveMember={(row) => {
            setSelectedRemovalMember(row);
            setRemoveError(null);
          }}
          onCopyInvitationLink={handleCopyInvitationLink}
          onRevokeInvitation={(row) => {
            setSelectedInvitation(row);
            setRevokeError(null);
          }}
          onResendInvitation={handleResendInvitation}
        />
      </div>

      <InviteMemberDialog
        canManage={canManage}
        error={inviteError}
        inviteEmail={inviteEmail}
        inviteRole={inviteRole}
        isPending={isInviting}
        onInviteEmailChange={setInviteEmail}
        onInviteRoleChange={setInviteRole}
        onOpenChange={(open) => {
          setInviteDialogOpen(open);
          if (!open) {
            setInviteError(null);
          }
        }}
        onSubmit={handleInviteSubmit}
        open={inviteDialogOpen}
      />

      <ChangeRoleDialog
        availableRoles={availableRoles}
        error={roleError}
        isPending={isUpdatingRole}
        nextRole={nextRole}
        onNextRoleChange={setNextRole}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRoleMember(null);
          }
        }}
        onSubmit={handleRoleSubmit}
        open={selectedRoleMember !== null}
        row={selectedRoleMember}
      />

      <DeleteConfirmationDialog
        open={selectedRemovalMember !== null}
        onClose={() => {
          setSelectedRemovalMember(null);
          setRemoveError(null);
        }}
        title="Remove member"
        description={`Remove ${selectedRemovalMember?.email ?? 'this member'} from ${organizationName}.`}
        deleteText="Remove member"
        isDeleting={isRemovingMember}
        error={removeError ?? undefined}
        onConfirm={handleRemoveMember}
        variant="danger"
      />

      <DeleteConfirmationDialog
        open={selectedInvitation !== null}
        onClose={() => {
          setSelectedInvitation(null);
          setRevokeError(null);
        }}
        title="Revoke invitation"
        description={`Revoke the invitation for ${selectedInvitation?.email ?? 'this invitee'}.`}
        deleteText="Revoke invitation"
        isDeleting={isRevokingInvitation}
        error={revokeError ?? undefined}
        onConfirm={handleRevokeInvitation}
        variant="danger"
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function InviteMemberDialog({
  canManage,
  error,
  inviteEmail,
  inviteRole,
  isPending,
  onInviteEmailChange,
  onInviteRoleChange,
  onOpenChange,
  onSubmit,
  open,
}: {
  canManage: boolean | undefined;
  error: string | null;
  inviteEmail: string;
  inviteRole: 'admin' | 'member';
  isPending: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: 'admin' | 'member') => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>Send a new Better Auth organization invitation.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => onInviteEmailChange(event.target.value)}
              disabled={isPending || !canManage}
              placeholder="teammate@example.com"
            />
          </Field>

          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select
              value={inviteRole}
              onValueChange={(value) => onInviteRoleChange(value as 'admin' | 'member')}
              disabled={isPending || !canManage}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {error ? <FieldError>{error}</FieldError> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isPending || !canManage || inviteEmail.trim().length === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Send invite'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleDialog({
  availableRoles,
  error,
  isPending,
  nextRole,
  onNextRoleChange,
  onOpenChange,
  onSubmit,
  open,
  row,
}: {
  availableRoles: OrganizationDirectoryRole[];
  error: string | null;
  isPending: boolean;
  nextRole: OrganizationDirectoryRole;
  onNextRoleChange: (value: OrganizationDirectoryRole) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  open: boolean;
  row: Extract<OrganizationDirectoryRow, { kind: 'member' }> | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change member role</DialogTitle>
          <DialogDescription>
            Update the Better Auth organization role for this member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel>Member</FieldLabel>
            <Input value={row?.email ?? ''} readOnly />
          </Field>

          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select
              value={nextRole}
              onValueChange={(value) => onNextRoleChange(value as OrganizationDirectoryRole)}
              disabled={isPending || availableRoles.length === 0}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {capitalize(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {error ? <FieldError>{error}</FieldError> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isPending || availableRoles.length === 0 || row === null}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save role'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
