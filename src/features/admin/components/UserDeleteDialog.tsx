import type { QueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { deleteUserServerFn } from '~/features/dashboard/admin.server';
import { queryInvalidators } from '~/lib/query-keys';

interface UserDeleteDialogProps {
  open: boolean;
  userId: string | null;
  confirmation: string;
  onConfirmationChange: (confirmation: string) => void;
  onClose: () => void;
  queryClient: QueryClient;
}

export function UserDeleteDialog({
  open,
  userId,
  confirmation,
  onConfirmationChange,
  onClose,
  queryClient,
}: UserDeleteDialogProps) {
  const confirmationId = useId();
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    deleteUserMutation.mutate({
      userId,
      confirmation,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-red-600">Delete User</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the user account and remove
            all associated data.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 pb-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={confirmationId}>Confirm</Label>
              <Input
                id={confirmationId}
                value={confirmation}
                onChange={(e) => onConfirmationChange(e.target.value)}
                placeholder="DELETE_USER_DATA"
              />
              <p className="text-sm text-gray-500">
                Please type <strong>DELETE_USER_DATA</strong> to confirm deletion.
              </p>
            </div>
            {deleteUserMutation.error && (
              <Alert variant="destructive">
                <AlertDescription>
                  {deleteUserMutation.error.message || 'Failed to delete user. Please try again.'}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmation !== 'DELETE_USER_DATA' || deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? 'Deleting...' : 'Delete User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
