import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, User as UserIcon, UserPlus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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
import { DEFAULT_ROLE, USER_ROLES, type UserRole } from '../../auth/types';
import { createAdminUserServerFn } from '../server/admin-management';

type CreatedUserResult = Awaited<ReturnType<typeof createAdminUserServerFn>>;

interface UserCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (result: CreatedUserResult) => void;
}

export function UserCreateDialog({ open, onClose, onCreated }: UserCreateDialogProps) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameId = useId();
  const emailId = useId();
  const roleId = useId();

  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      role: DEFAULT_ROLE,
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const result = await createAdminUserServerFn({
          data: {
            name: value.name.trim(),
            email: value.email.trim().toLowerCase(),
            role: value.role,
          },
        });

        await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
        onCreated?.(result);
        onClose();
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to create user');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset();
      setSubmitError(null);
    }
  }, [form, open]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>
            Create an employee account and send them an email to set their own password.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="grid gap-4 py-4">
            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) => {
                  const trimmed = value.trim();
                  if (!trimmed) return 'Name is required';
                  if (trimmed.length < 2) return 'Name must be at least 2 characters long';
                  if (trimmed.length > 80) return 'Name must be less than 80 characters';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                  <InputGroup>
                    <InputGroupIcon>
                      <UserIcon />
                    </InputGroupIcon>
                    <InputGroupInput
                      id={nameId}
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="Enter employee name"
                    />
                  </InputGroup>
                  {field.state.meta.errors.length > 0 ? (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  ) : null}
                </Field>
              )}
            </form.Field>

            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) => {
                  const normalized = value.trim().toLowerCase();
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (!normalized) return 'Email is required';
                  if (!emailRegex.test(normalized)) return 'Please enter a valid email address';
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={emailId}>Email</FieldLabel>
                  <InputGroup>
                    <InputGroupIcon>
                      <Mail />
                    </InputGroupIcon>
                    <InputGroupInput
                      id={emailId}
                      type="email"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="employee@hospital.org"
                    />
                  </InputGroup>
                  {field.state.meta.errors.length > 0 ? (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  ) : null}
                </Field>
              )}
            </form.Field>

            <form.Field
              name="role"
              validators={{
                onChange: ({ value }) => {
                  if (!Object.values(USER_ROLES).includes(value as UserRole)) {
                    return 'Invalid role selected';
                  }
                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={roleId}>Role</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value: UserRole) => field.handleChange(value)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id={roleId}>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={USER_ROLES.USER}>User</SelectItem>
                      <SelectItem value={USER_ROLES.ADMIN}>Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {field.state.meta.errors.length > 0 ? (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  ) : null}
                </Field>
              )}
            </form.Field>
          </div>

          {submitError ? (
            <div className="rounded border border-destructive bg-destructive/10 px-4 py-3 text-destructive">
              <p className="text-sm">{submitError}</p>
            </div>
          ) : null}

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit]}>
              {([canSubmit]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? (
                    'Creating...'
                  ) : (
                    <>
                      <UserPlus className="size-4" />
                      Create user
                    </>
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
