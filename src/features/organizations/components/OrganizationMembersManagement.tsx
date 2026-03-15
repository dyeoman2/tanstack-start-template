import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useAction, useQuery } from 'convex/react';
import { Download, Loader2, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { Button } from '~/components/ui/button';
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
import { Spinner } from '~/components/ui/spinner';
import { useToast } from '~/components/ui/toast';
import { OrganizationMembersTable } from '~/features/organizations/components/OrganizationMembersTable';
import { OrganizationWorkspaceNav } from '~/features/organizations/components/OrganizationWorkspaceNav';
import type {
  OrganizationCapabilities,
  OrganizationDirectoryKind,
  OrganizationDirectoryRole,
  OrganizationDirectoryRow,
  OrganizationDirectorySearchParams,
  OrganizationInvitePolicy,
} from '~/features/organizations/lib/organization-management';
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';
import {
  bulkOrganizationDirectoryActionServerFn,
  cancelOrganizationInvitationServerFn,
  createOrganizationInvitationServerFn,
  deactivateOrganizationMemberServerFn,
  reactivateOrganizationMemberServerFn,
  removeOrganizationMemberServerFn,
  suspendOrganizationMemberServerFn,
  updateOrganizationMemberRoleServerFn,
} from '~/features/organizations/server/organization-management';

const KIND_FILTER_OPTIONS: TableFilterOption<OrganizationDirectoryKind>[] = [
  { label: 'All rows', value: 'all' },
  { label: 'Members', value: 'member' },
  { label: 'Invites', value: 'invite' },
];

export function OrganizationMembersManagement({
  actions,
  fallbackOrganizationName,
  inviteDialogOpen: inviteDialogOpenProp,
  onInviteDialogOpenChange,
  searchParams,
  showHeader = true,
  slug,
  subnav,
}: {
  actions?: ReactNode;
  fallbackOrganizationName?: string;
  inviteDialogOpen?: boolean;
  onInviteDialogOpenChange?: (open: boolean) => void;
  searchParams: OrganizationDirectorySearchParams;
  showHeader?: boolean;
  slug: string;
  subnav?: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { showToast } = useToast();
  const exportDirectoryCsv = useAction(api.organizationManagement.exportOrganizationDirectoryCsv);
  const [directoryAsOf, setDirectoryAsOf] = useState(() => Date.now());
  const directory = useQuery(api.organizationManagement.listOrganizationDirectory, {
    slug,
    asOf: directoryAsOf,
    ...searchParams,
  });
  const createInvitation = createOrganizationInvitationServerFn;
  const updateMemberRole = updateOrganizationMemberRoleServerFn;
  const suspendMember = suspendOrganizationMemberServerFn;
  const deactivateMember = deactivateOrganizationMemberServerFn;
  const reactivateMember = reactivateOrganizationMemberServerFn;
  const removeMember = removeOrganizationMemberServerFn;
  const cancelInvitation = cancelOrganizationInvitationServerFn;
  const runBulkAction = bulkOrganizationDirectoryActionServerFn;
  const [inviteDialogOpenInternal, setInviteDialogOpenInternal] = useState(false);
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
  const [memberStatusAction, setMemberStatusAction] = useState<{
    action: 'suspend' | 'deactivate' | 'reactivate';
    row: Extract<OrganizationDirectoryRow, { kind: 'member' }>;
  } | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [isUpdatingMemberStatus, setIsUpdatingMemberStatus] = useState(false);
  const [isRemovingMember, setIsRemovingMember] = useState(false);
  const [isRevokingInvitation, setIsRevokingInvitation] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrganizationDirectoryRole>('member');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [nextRole, setNextRole] = useState<OrganizationDirectoryRole>('member');
  const [roleError, setRoleError] = useState<string | null>(null);
  const [memberStatusError, setMemberStatusError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedRoleMember) {
      return;
    }

    setNextRole(selectedRoleMember.role);
    setRoleError(null);
  }, [selectedRoleMember]);

  useEffect(() => {
    const availableInviteRoles = directory?.capabilities.availableInviteRoles ?? [];
    if (availableInviteRoles.length === 0) {
      return;
    }

    if (!availableInviteRoles.includes(inviteRole)) {
      setInviteRole(availableInviteRoles[0] ?? 'member');
    }
  }, [directory?.capabilities.availableInviteRoles, inviteRole]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setDirectoryAsOf(Date.now());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  const isLoading = directory === undefined;
  const inviteDialogOpen = inviteDialogOpenProp ?? inviteDialogOpenInternal;
  const rows = directory?.rows ?? [];
  const pagination = directory?.pagination ?? {
    page: searchParams.page,
    pageSize: searchParams.pageSize,
    total: 0,
    totalPages: 0,
  };
  const capabilities: OrganizationCapabilities | undefined = directory?.capabilities;
  const canInvite = capabilities?.canInvite ?? false;
  const organizationName = directory?.organization.name ?? fallbackOrganizationName ?? 'Organization';
  const policies = directory?.policies;
  const setInviteDialogOpen = (open: boolean) => {
    onInviteDialogOpenChange?.(open);

    if (inviteDialogOpenProp === undefined) {
      setInviteDialogOpenInternal(open);
    }
  };

  const refreshOrganizationState = async () => {
    await refreshOrganizationClientState(queryClient, {
      invalidateRouter: async () => {
        await router.invalidate();
      },
    });
  };

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

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const result = await exportDirectoryCsv({
        slug,
        asOf: directoryAsOf,
        sortBy: searchParams.sortBy,
        sortOrder: searchParams.sortOrder,
        secondarySortBy: searchParams.secondarySortBy,
        secondarySortOrder: searchParams.secondarySortOrder,
        search: searchParams.search,
        kind: searchParams.kind,
      });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast('Directory exported.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to export directory', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleInviteSubmit = async () => {
    if (!directory) {
      return;
    }

    setIsInviting(true);
    setInviteError(null);

    try {
      await createInvitation({
        data: {
          organizationId: directory.organization.id,
          email: inviteEmail.trim(),
          role: inviteRole,
        },
      });
      await refreshOrganizationState();
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
        data: {
          organizationId: directory.organization.id,
          membershipId: selectedRoleMember.membershipId,
          role: nextRole,
        },
      });
      await refreshOrganizationState();
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
        data: {
          organizationId: directory.organization.id,
          membershipId: selectedRemovalMember.membershipId,
        },
      });
      await refreshOrganizationState();
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

  const handleMemberStatusSubmit = async () => {
    if (!directory || !memberStatusAction) {
      return;
    }

    setIsUpdatingMemberStatus(true);
    setMemberStatusError(null);

    try {
      const payload = {
        organizationId: directory.organization.id,
        membershipId: memberStatusAction.row.membershipId,
      };

      if (memberStatusAction.action === 'suspend') {
        await suspendMember({ data: payload });
      } else if (memberStatusAction.action === 'deactivate') {
        await deactivateMember({ data: payload });
      } else {
        await reactivateMember({ data: payload });
      }

      await refreshOrganizationState();
      setMemberStatusAction(null);
      showToast(
        memberStatusAction.action === 'suspend'
          ? 'Member suspended.'
          : memberStatusAction.action === 'deactivate'
            ? 'Member deactivated.'
            : 'Member reactivated.',
        'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update member status';
      setMemberStatusError(message);
      showToast(message, 'error');
    } finally {
      setIsUpdatingMemberStatus(false);
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
        data: {
          organizationId: directory.organization.id,
          invitationId: selectedInvitation.invitationId,
        },
      });
      await refreshOrganizationState();
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
        data: {
          organizationId: directory.organization.id,
          email: invitation.email,
          role: invitation.role,
          resend: true,
        },
      });
      await refreshOrganizationState();
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
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedRowIds.has(row.id)),
    [rows, selectedRowIds],
  );
  const selectedMembers = selectedRows.filter(
    (row): row is Extract<OrganizationDirectoryRow, { kind: 'member' }> => row.kind === 'member',
  );
  const selectedInvites = selectedRows.filter(
    (row): row is Extract<OrganizationDirectoryRow, { kind: 'invite' }> => row.kind === 'invite',
  );

  const toggleAllRows = (checked: boolean) => {
    setSelectedRowIds(checked ? new Set(rows.map((row) => row.id)) : new Set());
  };

  const toggleRow = (rowId: string, checked: boolean) => {
    setSelectedRowIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }

      return next;
    });
  };

  const handleBulkAction = async (
    action: 'revoke-invites' | 'resend-invites' | 'remove-members',
  ) => {
    if (!directory) {
      return;
    }

    setIsBulkSubmitting(true);

    try {
      const result = await runBulkAction({
        data: {
          organizationId: directory.organization.id,
          action,
          invitations: selectedInvites.map((invitation) => ({
            invitationId: invitation.invitationId,
            email: invitation.email,
            role: invitation.role,
          })),
          members: selectedMembers.map((member) => ({
            membershipId: member.membershipId,
            email: member.email,
            role: member.role,
          })),
        },
      });

      await refreshOrganizationState();
      setSelectedRowIds(new Set());

      if (result.failureCount === 0) {
        showToast(
          action === 'revoke-invites'
            ? 'Invitations revoked.'
            : action === 'resend-invites'
              ? 'Invitations resent.'
              : 'Members removed.',
          'success',
        );
      } else {
        const firstFailure = result.results.find((entry) => !entry.success);
        showToast(
          `${result.successCount} succeeded, ${result.failureCount} failed${firstFailure?.message ? `: ${firstFailure.message}` : ''}`,
          result.successCount > 0 ? 'success' : 'error',
        );
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to run bulk organization action',
        'error',
      );
    } finally {
      setIsBulkSubmitting(false);
    }
  };

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
      {showHeader ? (
        <OrganizationWorkspaceNav
          title={organizationName}
          description="Manage members and invitations with one org-specific directory."
          actions={
            actions ??
            (canInvite ? (
              <Button size="sm" onClick={() => setInviteDialogOpen(true)}>
                <Plus className="size-4" />
                Invite member
              </Button>
            ) : undefined)
          }
        />
      ) : null}
      {subnav}

      <div className="grid gap-4 md:grid-cols-2">
        <SummaryCard label="Members" value={directory?.counts.members} isLoading={isLoading} />
        <SummaryCard
          label="Pending invites"
          value={directory?.counts.invites}
          isLoading={isLoading}
        />
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-end sm:flex-1">
            <TableSearch
              initialValue={searchParams.search}
              onSearch={handleSearchChange}
              placeholder="Search by name or email"
              className="min-w-[260px] sm:w-[360px] lg:w-[420px]"
              ariaLabel="Search organization members and invitations"
            />
            <Button type="button" variant="outline" onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              <span className="sr-only">Export CSV</span>
            </Button>
          </div>
        </div>

        {selectedRows.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {selectedRows.length} selected
              {selectedMembers.length > 0
                ? ` · ${selectedMembers.length} member${selectedMembers.length === 1 ? '' : 's'}`
                : ''}
              {selectedInvites.length > 0
                ? ` · ${selectedInvites.length} invite${selectedInvites.length === 1 ? '' : 's'}`
                : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isBulkSubmitting || selectedInvites.length === 0}
                onClick={() => {
                  void handleBulkAction('resend-invites');
                }}
              >
                {isBulkSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Resend invites
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isBulkSubmitting || selectedInvites.length === 0}
                onClick={() => {
                  void handleBulkAction('revoke-invites');
                }}
              >
                {isBulkSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Revoke invites
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isBulkSubmitting || selectedMembers.length === 0}
                onClick={() => {
                  void handleBulkAction('remove-members');
                }}
              >
                {isBulkSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Remove members
              </Button>
            </div>
          </div>
        ) : null}

        <OrganizationMembersTable
          slug={slug}
          rows={rows}
          pagination={pagination}
          searchParams={searchParams}
          selectedRowIds={selectedRowIds}
          isLoading={isLoading}
          onChangeRole={(row) => {
            setSelectedRoleMember(row);
            setRoleError(null);
          }}
          onSuspendMember={(row) => {
            setMemberStatusAction({ action: 'suspend', row });
            setMemberStatusError(null);
          }}
          onDeactivateMember={(row) => {
            setMemberStatusAction({ action: 'deactivate', row });
            setMemberStatusError(null);
          }}
          onReactivateMember={(row) => {
            setMemberStatusAction({ action: 'reactivate', row });
            setMemberStatusError(null);
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
          onToggleAllRows={toggleAllRows}
          onToggleRow={toggleRow}
        />
      </div>

      <InviteMemberDialog
        availableInviteRoles={capabilities?.availableInviteRoles ?? []}
        canManage={canInvite}
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
        open={memberStatusAction !== null}
        onClose={() => {
          setMemberStatusAction(null);
          setMemberStatusError(null);
        }}
        title={getMemberStatusDialogTitle(memberStatusAction?.action)}
        description={getMemberStatusDialogDescription(memberStatusAction, organizationName)}
        deleteText={getMemberStatusDialogActionLabel(memberStatusAction?.action)}
        isDeleting={isUpdatingMemberStatus}
        error={memberStatusError ?? undefined}
        onConfirm={handleMemberStatusSubmit}
        variant={memberStatusAction?.action === 'reactivate' ? 'normal' : 'danger'}
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

function SummaryCard({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: number | undefined;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="flex h-8 items-center text-2xl">
          {isLoading ? <Spinner className="size-8" /> : (value ?? 0)}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function InviteMemberDialog({
  availableInviteRoles,
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
  availableInviteRoles: OrganizationDirectoryRole[];
  canManage: boolean | undefined;
  error: string | null;
  inviteEmail: string;
  inviteRole: OrganizationDirectoryRole;
  isPending: boolean;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: OrganizationDirectoryRole) => void;
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
              onValueChange={(value) => onInviteRoleChange(value as OrganizationDirectoryRole)}
              disabled={isPending || !canManage}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableInviteRoles.map((role) => (
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

function getMemberStatusDialogTitle(action: 'suspend' | 'deactivate' | 'reactivate' | undefined) {
  switch (action) {
    case 'suspend':
      return 'Suspend member';
    case 'deactivate':
      return 'Deactivate member';
    case 'reactivate':
      return 'Reactivate member';
    default:
      return 'Update member';
  }
}

function getMemberStatusDialogActionLabel(
  action: 'suspend' | 'deactivate' | 'reactivate' | undefined,
) {
  switch (action) {
    case 'suspend':
      return 'Suspend member';
    case 'deactivate':
      return 'Deactivate member';
    case 'reactivate':
      return 'Reactivate member';
    default:
      return 'Continue';
  }
}

function getMemberStatusDialogDescription(
  state: {
    action: 'suspend' | 'deactivate' | 'reactivate';
    row: Extract<OrganizationDirectoryRow, { kind: 'member' }>;
  } | null,
  organizationName: string,
) {
  if (!state) {
    return 'Update this member status.';
  }

  switch (state.action) {
    case 'suspend':
      return `Suspend ${state.row.email} from ${organizationName}. They will lose organization access until reactivated.`;
    case 'deactivate':
      return `Deactivate ${state.row.email} in ${organizationName}. They will lose organization access until reactivated.`;
    case 'reactivate':
      return `Reactivate ${state.row.email} in ${organizationName}. Their organization access will be restored.`;
    default:
      return 'Update this member status.';
  }
}
