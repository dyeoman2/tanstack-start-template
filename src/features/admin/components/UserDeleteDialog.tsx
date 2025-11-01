import { api } from '@convex/_generated/api';
import { useState } from 'react';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { useOptimisticMutation } from '../hooks/useOptimisticUpdates';

interface UserDeleteDialogProps {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}

export function UserDeleteDialog({ open, userId, onClose }: UserDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // Optimistic mutation with automatic rollback on error
  const deleteUserOptimistic = useOptimisticMutation(api.admin.deleteUser, {
    onSuccess: () => {
      // User deleted successfully - dialog will close
    },
    onError: (error) => {
      console.error('Delete user failed:', error);
      setError(error.message);
    },
  });

  const handleConfirm = async () => {
    if (!userId) return;

    setIsDeleting(true);
    setError(undefined);

    try {
      // Optimistic delete - Convex automatically removes from cache and updates queries
      await deleteUserOptimistic({ userId });
      // Convex queries update automatically - no manual cache invalidation needed!
      onClose();
    } catch (err) {
      // Error handling is done in the onError callback above
      console.error('Delete user failed:', err);
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
