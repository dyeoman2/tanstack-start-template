import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Clock3, Edit3, LogIn, MoreHorizontal, Shield, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { createSortableHeader, DataTable, formatTableDate } from '~/components/data-table';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { DEFAULT_ROLE, USER_ROLES } from '../../auth/types';
import type { User as AdminUser } from '../types';

type UserRow = AdminUser;

interface UserTableProps {
  users: UserRow[];
  currentUserId?: string;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  searchParams: {
    page: number;
    pageSize: number;
    sortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
    sortOrder: 'asc' | 'desc';
    secondarySortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
    secondarySortOrder: 'asc' | 'desc';
    search: string;
    role: 'all' | 'admin' | 'user';
  };
  isLoading: boolean;
  isFetching?: boolean;
  onEditUser: (user: UserRow) => void;
  onDeleteUser: (userId: string) => void;
  onManageBan: (user: UserRow) => void;
  onManageSessions: (user: UserRow) => void;
  onResetPassword: (user: UserRow) => void;
  onImpersonateUser: (userId: string) => void;
  pendingImpersonationUserId: string | null;
}

export function UserTable({
  users,
  currentUserId,
  pagination,
  searchParams,
  isLoading,
  isFetching = false,
  onEditUser,
  onDeleteUser,
  onManageBan,
  onManageSessions,
  onResetPassword,
  onImpersonateUser,
  pendingImpersonationUserId,
}: UserTableProps) {
  const navigate = useNavigate();

  // Sorting and pagination handlers
  const handleSorting = useCallback(
    (columnId: string) => {
      const newSortOrder =
        searchParams.sortBy === columnId && searchParams.sortOrder === 'asc' ? 'desc' : 'asc';
      navigate({
        to: '/app/admin/users',
        search: {
          ...searchParams,
          sortBy: columnId as 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt',
          sortOrder: newSortOrder,
          page: 1, // Reset to first page when sorting changes
        },
      });
    },
    [searchParams, navigate],
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      navigate({
        to: '/app/admin/users',
        search: {
          ...searchParams,
          page: newPage,
        },
      });
    },
    [searchParams, navigate],
  );

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      navigate({
        to: '/app/admin/users',
        search: {
          ...searchParams,
          pageSize: newPageSize,
          page: 1, // Reset to first page when page size changes
        },
      });
    },
    [searchParams, navigate],
  );

  // Define table columns
  const tableColumns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: createSortableHeader('Name', 'name', searchParams, handleSorting),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {row.original.name ?? 'No name'}
          </span>
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
        accessorKey: 'role',
        header: createSortableHeader('Role', 'role', searchParams, handleSorting),
        cell: ({ row }) => {
          const role = row.original.role ?? DEFAULT_ROLE;
          const isAdmin = role === USER_ROLES.ADMIN;
          const roleLabel = `${role.slice(0, 1).toUpperCase()}${role.slice(1)}`;

          return (
            <Badge variant={isAdmin ? 'destructive' : 'secondary'}>
              {isAdmin && <Shield className="h-3 w-3 mr-1" />}
              {roleLabel}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'emailVerified',
        header: createSortableHeader('Status', 'emailVerified', searchParams, handleSorting),
        cell: ({ row }) => {
          if (row.original.banned) {
            return (
              <div className="space-y-1">
                <Badge variant="destructive">Banned</Badge>
                {row.original.banExpires ? (
                  <p className="text-xs text-muted-foreground">
                    Until {formatTableDate(row.original.banExpires)}
                  </p>
                ) : null}
              </div>
            );
          }

          return (
            <Badge variant={row.original.emailVerified ? 'default' : 'outline'}>
              {row.original.emailVerified ? 'Verified' : 'Unverified'}
            </Badge>
          );
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
          const canImpersonate =
            row.original.role !== USER_ROLES.ADMIN &&
            row.original.id !== currentUserId &&
            !row.original.banned;
          const isCurrentUser = row.original.id === currentUserId;
          const canManageDangerousActions = !isCurrentUser;

          return (
            <div className="text-right">
              <div className="flex items-center justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">More actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEditUser(row.original)}>
                      <Edit3 className="size-4" />
                      Edit user
                    </DropdownMenuItem>
                    {canImpersonate ? (
                      <DropdownMenuItem
                        onSelect={() => onImpersonateUser(row.original.id)}
                        disabled={pendingImpersonationUserId === row.original.id}
                      >
                        <LogIn className="size-4" />
                        Impersonate user
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => onManageBan(row.original)}
                      disabled={!canManageDangerousActions}
                    >
                      <Ban className="size-4" />
                      {row.original.banned ? 'Unban user' : 'Ban user'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onManageSessions(row.original)}>
                      <Clock3 className="size-4" />
                      Manage sessions
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onResetPassword(row.original)}>
                      <Edit3 className="size-4" />
                      Reset password
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDeleteUser(row.original.id)}
                      disabled={!canManageDangerousActions}
                    >
                      <Trash2 className="size-4" />
                      Delete user
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        },
      },
    ],
    [
      currentUserId,
      handleSorting,
      onDeleteUser,
      onEditUser,
      onManageBan,
      onManageSessions,
      onImpersonateUser,
      onResetPassword,
      pendingImpersonationUserId,
      searchParams,
    ],
  );

  return (
    <DataTable<UserRow, (typeof tableColumns)[number]>
      data={users}
      columns={tableColumns}
      pagination={pagination}
      searchParams={searchParams}
      isLoading={isLoading}
      isFetching={isFetching}
      onPageChange={handlePageChange}
      onPageSizeChange={handlePageSizeChange}
      emptyMessage="No users found."
    />
  );
}
