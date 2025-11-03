import { api } from '@convex/_generated/api';
import { useForm } from '@tanstack/react-form';
import { Mail, User as UserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import type { UserRole } from '../../auth/types';
import { DEFAULT_ROLE, USER_ROLES } from '../../auth/types';
import { useOptimisticMutation } from '../hooks/useOptimisticUpdates';
import type { User } from '../types';

interface UserEditDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
}

export function UserEditDialog({ open, user, onClose }: UserEditDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Optimistic mutations with automatic rollback on error
  const updateBetterAuthUserOptimistic = useOptimisticMutation(api.admin.updateBetterAuthUser);
  const setUserRoleOptimistic = useOptimisticMutation(api.users.setUserRole);

  const form = useForm({
    defaultValues: {
      name: user?.name || '',
      email: user?.email || '',
      role: (user?.role as UserRole) || DEFAULT_ROLE,
    },
    onSubmit: async ({ value }) => {
      if (!user?.id) return;

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const trimmedName = value.name.trim();
        const trimmedEmail = value.email.trim().toLowerCase();

        // Execute updates in parallel with optimistic updates
        const updatePromises: Promise<{ success: boolean }>[] = [];

        // Optimistic update for name - Convex handles cache invalidation automatically
        if (trimmedName !== user.name) {
          updatePromises.push(
            updateBetterAuthUserOptimistic({
              userId: user.id,
              name: trimmedName,
            }),
          );
        }

        // Optimistic update for email - Convex handles cache invalidation automatically
        if (trimmedEmail !== user.email.toLowerCase()) {
          updatePromises.push(
            updateBetterAuthUserOptimistic({
              userId: user.id,
              email: trimmedEmail,
            }),
          );
        }

        // Optimistic update for role - Convex handles cache invalidation automatically
        if (value.role !== user.role) {
          updatePromises.push(
            setUserRoleOptimistic({
              userId: user.id,
              role: value.role,
            }),
          );
        }

        // Execute all necessary updates in parallel
        if (updatePromises.length > 0) {
          await Promise.all(updatePromises);
        }

        // Convex automatically handles cache invalidation and real-time updates!
        onClose();
      } catch (error) {
        console.error('Failed to update user:', error);
        setSubmitError(error instanceof Error ? error.message : 'Failed to update user');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  // Update form values when user changes
  useEffect(() => {
    if (user) {
      form.reset({
        name: user.name || '',
        email: user.email || '',
        role: (user.role as UserRole) || DEFAULT_ROLE,
      });
    }
  }, [user, form]);

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
                  if (!Object.values(USER_ROLES).includes(value as UserRole))
                    return 'Invalid role selected';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel>Role</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value: UserRole) => field.handleChange(value)}
                    disabled={isSubmitting}
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
          {submitError && (
            <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded">
              <p className="text-sm">{submitError}</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, _isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save changes'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
