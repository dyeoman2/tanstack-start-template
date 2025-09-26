import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLoaderData } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { getAllUsersServerFn } from '~/features/dashboard/admin.server';
import { ADMIN_KEYS } from '~/lib/query-keys';
import { UserDeleteDialog } from './UserDeleteDialog';
import { UserEditDialog } from './UserEditDialog';
import { UserTable } from './UserTable';

type AdminUser = Awaited<ReturnType<typeof getAllUsersServerFn>>[number];

export function UserManagement() {
  // Get initial data from loader
  const loaderData = useLoaderData({ from: '/admin/users' }) as AdminUser[];
  const nameId = useId();
  const emailId = useId();

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const queryClient = useQueryClient();

  const { data: users, isPending: usersPending } = useQuery({
    queryKey: ADMIN_KEYS.USERS_ALL,
    queryFn: () => getAllUsersServerFn(),
    initialData: loaderData, // Use loader data as initial data
  });

  const handleEditUser = (user: AdminUser) => {
    setSelectedUser(user);
    setEditName(user.name || '');
    setEditEmail(user.email);
    setShowEditDialog(true);
  };

  const handleDeleteUser = (userId: string) => {
    setSelectedUserId(userId);
    setShowDeleteDialog(true);
  };

  const handleCloseDialogs = () => {
    setShowDeleteDialog(false);
    setShowEditDialog(false);
    setSelectedUser(null);
    setSelectedUserId(null);
    setDeleteConfirmation('');
    setEditName('');
    setEditEmail('');
  };

  return (
    <div className="px-4 py-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
          <p className="mt-2 text-sm text-gray-700">
            Manage user accounts, roles, and permissions.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <UserTable
          users={users || []}
          isLoading={usersPending}
          onEditUser={handleEditUser}
          onDeleteUser={handleDeleteUser}
        />
      </div>

      <UserEditDialog
        open={showEditDialog}
        user={selectedUser}
        name={editName}
        email={editEmail}
        nameId={nameId}
        emailId={emailId}
        onNameChange={setEditName}
        onEmailChange={setEditEmail}
        onClose={handleCloseDialogs}
        queryClient={queryClient}
      />

      <UserDeleteDialog
        open={showDeleteDialog}
        userId={selectedUserId}
        confirmation={deleteConfirmation}
        onConfirmationChange={setDeleteConfirmation}
        onClose={handleCloseDialogs}
        queryClient={queryClient}
      />
    </div>
  );
}
