import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { UserPlus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { TableFilter, type TableFilterOption, TableSearch } from '~/components/data-table';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import type { UserRole } from '../../auth/types';
import { USER_ROLES } from '../../auth/types';
import { useUserImpersonation } from '../hooks/useUserImpersonation';
import {
  listAdminUsersServerFn,
  sendAdminUserOnboardingEmailServerFn,
} from '../server/admin-management';
import type { User as AdminUser } from '../types';
import { UserBanDialog } from './UserBanDialog';
import { UserCreateDialog } from './UserCreateDialog';
import { UserDeleteDialog } from './UserDeleteDialog';
import { UserEditDialog } from './UserEditDialog';
import { UserPasswordResetDialog } from './UserPasswordResetDialog';
import { UserSessionsDialog } from './UserSessionsDialog';
import { UserTable } from './UserTable';

type UserRoleFilterValue = 'all' | UserRole;
type AdminDialog = 'edit' | 'delete' | 'ban' | 'sessions' | 'password' | null;

const ROLE_FILTER_OPTIONS: TableFilterOption<UserRoleFilterValue>[] = [
  { label: 'All roles', value: 'all' },
  { label: 'Admin', value: USER_ROLES.ADMIN },
  { label: 'User', value: USER_ROLES.USER },
];

export function UserManagement() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/admin/users' });
  const authState = useAuthState();
  const { user: currentUser } = useAuth({ fetchRole: authState.isAuthenticated });
  const { showToast } = useToast();
  const searchTerm = search.search ?? '';
  const roleFilter = (search.role ?? 'all') as UserRoleFilterValue;

  const [activeDialog, setActiveDialog] = useState<AdminDialog>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [pendingOnboardingUserId, setPendingOnboardingUserId] = useState<string | null>(null);
  const { impersonateUser, pendingUserId } = useUserImpersonation();

  const adminUsersSearchParams = useMemo(
    () =>
      ({
        ...search,
        role: roleFilter,
      }) satisfies {
        page: number;
        pageSize: number;
        sortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
        sortOrder: 'asc' | 'desc';
        secondarySortBy: 'name' | 'email' | 'role' | 'emailVerified' | 'createdAt';
        secondarySortOrder: 'asc' | 'desc';
        search: string;
        role: UserRoleFilterValue;
        cursor?: string; // Add cursor for optimized pagination
      },
    [roleFilter, search],
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-users', adminUsersSearchParams],
    queryFn: () => listAdminUsersServerFn({ data: adminUsersSearchParams }),
    placeholderData: keepPreviousData,
  });

  const users = useMemo<AdminUser[]>(() => data?.users ?? [], [data]);
  const pagination = data?.pagination;

  const handleEditUser = (user: AdminUser) => {
    setSelectedUser(user);
    setActiveDialog('edit');
  };

  const handleDeleteUser = (userId: string) => {
    const user = users.find((candidate: AdminUser) => candidate.id === userId) ?? null;
    setSelectedUser(user);
    setActiveDialog('delete');
  };

  const handleManageBan = (user: AdminUser) => {
    setSelectedUser(user);
    setActiveDialog('ban');
  };

  const handleManageSessions = (user: AdminUser) => {
    setSelectedUser(user);
    setActiveDialog('sessions');
  };

  const handleResetPassword = (user: AdminUser) => {
    setSelectedUser(user);
    setActiveDialog('password');
  };

  const handleCloseDialogs = () => {
    setActiveDialog(null);
    setSelectedUser(null);
  };

  const handleResendOnboardingEmail = useCallback(
    async (user: AdminUser) => {
      setPendingOnboardingUserId(user.id);

      try {
        await sendAdminUserOnboardingEmailServerFn({
          data: {
            userId: user.id,
          },
        });
        showToast(`Onboarding email sent to ${user.email}.`, 'success');
        await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to send onboarding email',
          'error',
        );
      } finally {
        setPendingOnboardingUserId(null);
      }
    },
    [queryClient, showToast],
  );

  const handleSearchChange = useCallback(
    (term: string) => {
      const normalizedTerm = term.trim();
      if (normalizedTerm === searchTerm.trim()) {
        return;
      }

      void navigate({
        to: '/app/admin/users',
        search: {
          ...adminUsersSearchParams,
          search: normalizedTerm,
          page: 1,
        },
      });
    },
    [adminUsersSearchParams, navigate, searchTerm],
  );

  const handleRoleFilterChange = useCallback(
    (nextRole: UserRoleFilterValue) => {
      if (nextRole === roleFilter) {
        return;
      }

      void navigate({
        to: '/app/admin/users',
        search: {
          ...adminUsersSearchParams,
          role: nextRole,
          page: 1,
        },
      });
    },
    [adminUsersSearchParams, navigate, roleFilter],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Manage user accounts, roles, and permissions."
        actions={
          <Button type="button" size="sm" onClick={() => setIsCreateDialogOpen(true)}>
            <UserPlus className="size-4" />
            Create user
          </Button>
        }
      />

      <div className="mt-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TableFilter<UserRoleFilterValue>
            label="Role"
            value={roleFilter}
            options={ROLE_FILTER_OPTIONS}
            onValueChange={handleRoleFilterChange}
            className="sm:w-48"
            ariaLabel="Filter users by role"
          />
          <TableSearch
            initialValue={searchTerm}
            onSearch={handleSearchChange}
            placeholder="Search by name or email"
            isSearching={false}
            className="min-w-[260px] sm:max-w-lg"
            ariaLabel="Search users by name or email"
          />
        </div>
        <UserTable
          users={users}
          pagination={pagination || { page: 1, pageSize: 10, total: 0, totalPages: 0 }}
          searchParams={adminUsersSearchParams}
          currentUserId={currentUser?.id}
          isLoading={isLoading}
          isFetching={isFetching}
          onEditUser={handleEditUser}
          onDeleteUser={handleDeleteUser}
          onManageBan={handleManageBan}
          onManageSessions={handleManageSessions}
          onImpersonateUser={impersonateUser}
          onResetPassword={handleResetPassword}
          onResendOnboardingEmail={handleResendOnboardingEmail}
          pendingImpersonationUserId={pendingUserId}
          pendingOnboardingUserId={pendingOnboardingUserId}
        />
      </div>

      <UserEditDialog
        open={activeDialog === 'edit'}
        user={selectedUser}
        onClose={handleCloseDialogs}
      />

      <UserBanDialog
        open={activeDialog === 'ban'}
        user={selectedUser}
        onClose={handleCloseDialogs}
      />

      <UserSessionsDialog
        open={activeDialog === 'sessions'}
        user={selectedUser}
        onClose={handleCloseDialogs}
      />

      <UserPasswordResetDialog
        open={activeDialog === 'password'}
        user={selectedUser}
        onClose={handleCloseDialogs}
      />

      <UserDeleteDialog
        open={activeDialog === 'delete'}
        userId={selectedUser?.id ?? null}
        onClose={handleCloseDialogs}
      />

      <UserCreateDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreated={(result) => {
          if (result.onboardingEmailSent) {
            showToast('User created and onboarding email sent.', 'success');
            return;
          }

          showToast(
            result.onboardingErrorMessage ??
              'User created, but sending the onboarding email failed.',
            'error',
          );
        }}
      />
    </div>
  );
}
