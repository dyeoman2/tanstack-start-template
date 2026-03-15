import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Copy,
  MoreHorizontal,
  Shield,
  Trash2,
  UserCheck,
  UserCog,
  UserRoundPlus,
  UserX,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { createSortableHeader, DataTable, formatTableDate } from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import type {
  OrganizationDirectoryRow,
  OrganizationDirectorySearchParams,
} from '~/features/organizations/lib/organization-management';

interface OrganizationMembersTableProps {
  isFetching?: boolean;
  isLoading: boolean;
  onChangeRole: (row: Extract<OrganizationDirectoryRow, { kind: 'member' }>) => void;
  onCopyInvitationLink: (row: Extract<OrganizationDirectoryRow, { kind: 'invite' }>) => void;
  onDeactivateMember: (row: Extract<OrganizationDirectoryRow, { kind: 'member' }>) => void;
  onRemoveMember: (row: Extract<OrganizationDirectoryRow, { kind: 'member' }>) => void;
  onReactivateMember: (row: Extract<OrganizationDirectoryRow, { kind: 'member' }>) => void;
  onRevokeInvitation: (row: Extract<OrganizationDirectoryRow, { kind: 'invite' }>) => void;
  onResendInvitation: (row: Extract<OrganizationDirectoryRow, { kind: 'invite' }>) => void;
  onSuspendMember: (row: Extract<OrganizationDirectoryRow, { kind: 'member' }>) => void;
  onToggleAllRows: (checked: boolean) => void;
  onToggleRow: (rowId: string, checked: boolean) => void;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  rows: OrganizationDirectoryRow[];
  searchParams: OrganizationDirectorySearchParams;
  selectedRowIds: Set<string>;
  slug: string;
}

export function OrganizationMembersTable({
  isFetching = false,
  isLoading,
  onChangeRole,
  onCopyInvitationLink,
  onDeactivateMember,
  onRemoveMember,
  onReactivateMember,
  onRevokeInvitation,
  onResendInvitation,
  onSuspendMember,
  onToggleAllRows,
  onToggleRow,
  pagination,
  rows,
  searchParams,
  selectedRowIds,
  slug,
}: OrganizationMembersTableProps) {
  const navigate = useNavigate();
  const allRowsSelected = rows.length > 0 && rows.every((row) => selectedRowIds.has(row.id));
  const someRowsSelected = rows.some((row) => selectedRowIds.has(row.id));

  const handleSorting = useCallback(
    (columnId: string) => {
      const nextSortOrder =
        searchParams.sortBy === columnId && searchParams.sortOrder === 'asc' ? 'desc' : 'asc';

      void navigate({
        to: '/app/organizations/$slug/members',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          sortBy: columnId as OrganizationDirectorySearchParams['sortBy'],
          sortOrder: nextSortOrder,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      void navigate({
        to: '/app/organizations/$slug/members',
        params: { slug },
        search: {
          ...searchParams,
          page,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      void navigate({
        to: '/app/organizations/$slug/members',
        params: { slug },
        search: {
          ...searchParams,
          page: 1,
          pageSize,
        },
      });
    },
    [navigate, searchParams, slug],
  );

  const columns = useMemo<ColumnDef<OrganizationDirectoryRow, unknown>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <div className="flex items-center">
            <Checkbox
              checked={allRowsSelected ? true : someRowsSelected ? 'indeterminate' : false}
              onCheckedChange={(checked) => onToggleAllRows(checked === true)}
              aria-label="Select all visible organization rows"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex items-center">
            <Checkbox
              checked={selectedRowIds.has(row.original.id)}
              onCheckedChange={(checked) => onToggleRow(row.original.id, checked === true)}
              aria-label={`Select ${row.original.email}`}
            />
          </div>
        ),
      },
      {
        accessorKey: 'name',
        header: createSortableHeader('Name', 'name', searchParams, handleSorting),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {row.original.name ?? 'Pending invite'}
            </p>
            {row.original.kind === 'member' && row.original.isSiteAdmin ? (
              <Badge variant="outline" className="w-fit shrink-0">
                <Shield className="mr-1 size-3" />
                Site admin
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: createSortableHeader('Email', 'email', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.email}</span>
        ),
      },
      {
        accessorKey: 'kind',
        header: createSortableHeader('Type', 'kind', searchParams, handleSorting),
        cell: ({ row }) => (
          <Badge variant="secondary">{row.original.kind === 'member' ? 'Member' : 'Invite'}</Badge>
        ),
      },
      {
        accessorKey: 'role',
        header: createSortableHeader('Role', 'role', searchParams, handleSorting),
        cell: ({ row }) => (
          <Badge variant={row.original.role === 'owner' ? 'default' : 'outline'}>
            {capitalize(row.original.role)}
          </Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: createSortableHeader('Status', 'status', searchParams, handleSorting),
        cell: ({ row }) => {
          const variant =
            row.original.status === 'expired' || row.original.status === 'suspended'
              ? 'destructive'
              : row.original.status === 'deactivated'
                ? 'outline'
                : 'secondary';

          return <Badge variant={variant}>{capitalize(row.original.status)}</Badge>;
        },
      },
      {
        accessorKey: 'createdAt',
        header: createSortableHeader('Created', 'createdAt', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatTableDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const rowData = row.original;

          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Organization row actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {rowData.kind === 'member' ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() => onChangeRole(rowData)}
                        disabled={!rowData.canChangeRole}
                      >
                        <UserCog className="size-4" />
                        Change role
                      </DropdownMenuItem>
                      {rowData.status === 'active' ? (
                        <>
                          <DropdownMenuItem
                            onSelect={() => onSuspendMember(rowData)}
                            disabled={!rowData.canSuspend}
                          >
                            <UserX className="size-4" />
                            Suspend member
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => onDeactivateMember(rowData)}
                            disabled={!rowData.canDeactivate}
                          >
                            <UserX className="size-4" />
                            Deactivate member
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() => onReactivateMember(rowData)}
                          disabled={!rowData.canReactivate}
                        >
                          <UserCheck className="size-4" />
                          Reactivate member
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onRemoveMember(rowData)}
                        disabled={!rowData.canRemove}
                      >
                        <Trash2 className="size-4" />
                        Remove member
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <>
                      <DropdownMenuItem
                        onSelect={() => onResendInvitation(rowData)}
                        disabled={!rowData.canRevoke}
                      >
                        <UserRoundPlus className="size-4" />
                        Resend invitation
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onCopyInvitationLink(rowData)}>
                        <Copy className="size-4" />
                        Copy invite link
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onRevokeInvitation(rowData)}
                        disabled={!rowData.canRevoke}
                      >
                        <Trash2 className="size-4" />
                        Revoke invitation
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [
      handleSorting,
      onChangeRole,
      onCopyInvitationLink,
      onDeactivateMember,
      onRemoveMember,
      onReactivateMember,
      onResendInvitation,
      onRevokeInvitation,
      onSuspendMember,
      onToggleAllRows,
      onToggleRow,
      searchParams,
      allRowsSelected,
      selectedRowIds,
      someRowsSelected,
    ],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      pagination={pagination}
      searchParams={searchParams}
      isLoading={isLoading}
      isFetching={isFetching}
      onPageChange={handlePageChange}
      onPageSizeChange={handlePageSizeChange}
      emptyMessage="No organization members or invitations matched this view."
    />
  );
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
