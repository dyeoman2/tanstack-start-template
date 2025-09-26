import type { QueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  emailVerified: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  updateUserProfileServerFn,
  updateUserRoleServerFn,
} from '~/features/dashboard/admin.server';
import { queryInvalidators } from '~/lib/query-keys';

interface UserEditDialogProps {
  open: boolean;
  user: AdminUser | null;
  name: string;
  email: string;
  nameId: string;
  emailId: string;
  onNameChange: (name: string) => void;
  onEmailChange: (email: string) => void;
  onClose: () => void;
  queryClient: QueryClient;
}

export function UserEditDialog({
  open,
  user,
  name,
  email,
  nameId,
  emailId,
  onNameChange,
  onEmailChange,
  onClose,
  queryClient,
}: UserEditDialogProps) {
  const [selectedRole, setSelectedRole] = useState<'user' | 'admin'>('user');

  // Initialize role when dialog opens with user data
  useEffect(() => {
    if (open && user?.role) {
      setSelectedRole(user.role as 'user' | 'admin');
    }
  }, [open, user]);

  const updateProfileMutation = useMutation({
    mutationFn: (variables: { userId: string; name: string; email: string }) =>
      updateUserProfileServerFn({ data: variables }),
    onSuccess: () => {
      queryInvalidators.composites.afterAdminUserOperation(queryClient);
      onClose();
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: (variables: { userId: string; role: 'user' | 'admin' }) =>
      updateUserRoleServerFn({ data: variables }),
    onSuccess: () => {
      queryInvalidators.composites.afterAdminUserOperation(queryClient);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;

    // Update profile (name and email)
    updateProfileMutation.mutate({
      userId: user.id,
      name: name.trim(),
      email: email.trim().toLowerCase(),
    });

    // Update role if it changed
    if (selectedRole !== user.role) {
      updateRoleMutation.mutate({
        userId: user.id,
        role: selectedRole,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Make changes to the user's profile and role. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={nameId} className="text-sm font-medium text-gray-700">
                Name
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Enter user name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={emailId} className="text-sm font-medium text-gray-700">
                Email
              </Label>
              <Input
                id={emailId}
                type="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Role</Label>
              <Select
                value={selectedRole}
                onValueChange={(value: 'user' | 'admin') => setSelectedRole(value)}
                disabled={updateRoleMutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
