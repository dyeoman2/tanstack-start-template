import { useForm } from '@tanstack/react-form';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { Mail, User as UserIcon } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { updateUserProfileServerFn } from '~/features/dashboard/admin.server';
import { queryInvalidators } from '~/lib/query-keys';
import type { User } from '../server/admin-loader.server';

interface UserEditDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
  queryClient: QueryClient;
}

export function UserEditDialog({ open, user, onClose, queryClient }: UserEditDialogProps) {
  const form = useForm({
    defaultValues: {
      name: user?.name || '',
      email: user?.email || '',
      role: (user?.role as 'user' | 'admin') || 'user',
    },
    onSubmit: async ({ value }) => {
      if (!user?.id) return;

      // Update profile (name and email)
      updateProfileMutation.mutate({
        userId: user.id,
        name: value.name.trim(),
        email: value.email.trim().toLowerCase(),
        role: value.role,
      });
    },
  });

  // Update form values when user changes
  useEffect(() => {
    if (user) {
      form.reset({
        name: user.name || '',
        email: user.email || '',
        role: (user.role as 'user' | 'admin') || 'user',
      });
    }
  }, [user, form]);

  const updateProfileMutation = useMutation({
    mutationFn: (variables: {
      userId: string;
      name: string;
      email: string;
      role: 'user' | 'admin';
    }) => updateUserProfileServerFn({ data: variables }),
    onSuccess: () => {
      queryInvalidators.composites.afterAdminUserOperation(queryClient);
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Make changes to the user's profile and role. Click save when you're done.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="grid gap-4 py-4">
            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) => {
                  if (!value.trim()) return 'Name is required';
                  if (value.length < 2) return 'Name must be at least 2 characters long';
                  if (value.length > 50) return 'Name must be less than 50 characters';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <InputGroup>
                    <InputGroupIcon>
                      <UserIcon />
                    </InputGroupIcon>
                    <InputGroupInput
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="Enter user name"
                    />
                  </InputGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) => {
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!value.trim()) return 'Email is required';
                  if (!emailRegex.test(value)) return 'Please enter a valid email address';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <InputGroup>
                    <InputGroupIcon>
                      <Mail />
                    </InputGroupIcon>
                    <InputGroupInput
                      type="email"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="Enter email address"
                    />
                  </InputGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  )}
                </Field>
              )}
            </form.Field>
            <form.Field
              name="role"
              validators={{
                onChange: ({ value }) => {
                  if (!value) return 'Role is required';
                  if (!['user', 'admin'].includes(value)) return 'Invalid role selected';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel>Role</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value: 'user' | 'admin') => field.handleChange(value)}
                    disabled={updateProfileMutation.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  )}
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, _isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || updateProfileMutation.isPending}>
                  {updateProfileMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
