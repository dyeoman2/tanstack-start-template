import { useState } from 'react';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { deleteUserServerFn } from '~/features/dashboard/admin.server';

interface UserDeleteDialogProps {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}

export function UserDeleteDialog({ open, userId, onClose }: UserDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleConfirm = async () => {
    if (!userId) return;

    setIsDeleting(true);
    setError(undefined);

    try {
      await deleteUserServerFn({
        data: {
          userId,
          confirmation: 'DELETE_USER_DATA',
        },
      });
      // Convex queries update automatically - no cache invalidation needed!
      onClose();
    } catch (err) {
      console.error('Delete user failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setIsDeleting(false);
    }
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
      isDeleting={isDeleting}
      error={error}
      onConfirm={handleConfirm}
      variant="danger"
    />
  );
}
