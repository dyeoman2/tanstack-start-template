import type { QueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { deleteUserServerFn } from '~/features/dashboard/admin.server';
import { queryInvalidators } from '~/lib/query-keys';

interface UserDeleteDialogProps {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  queryClient: QueryClient;
}

export function UserDeleteDialog({ open, userId, onClose, queryClient }: UserDeleteDialogProps) {
  const deleteUserMutation = useMutation({
    mutationFn: (variables: { userId: string; confirmation: string }) =>
      deleteUserServerFn({ data: variables }),
    onSuccess: () => {
      queryInvalidators.composites.afterAdminUserOperation(queryClient);
      onClose();
    },
    onError: (error) => {
      // Error is handled in the UI through the mutation state
      console.error('Delete user failed:', error);
    },
  });

  const handleConfirm = () => {
    if (!userId) return;

    deleteUserMutation.mutate({
      userId,
      confirmation: 'DELETE_USER_DATA',
    });
  };

  return (
    <DeleteConfirmationDialog
      open={open}
      onClose={onClose}
      title="Delete User"
      description="This action cannot be undone. This will permanently delete the user account and remove all associated data."
      confirmationPhrase="DELETE_USER_DATA"
      confirmationPlaceholder="DELETE_USER_DATA"
      deleteText="Delete User"
      isDeleting={deleteUserMutation.isPending}
      error={deleteUserMutation.error?.message}
      onConfirm={handleConfirm}
      variant="danger"
    />
  );
}
