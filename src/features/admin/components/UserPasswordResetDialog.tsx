import { useForm } from '@tanstack/react-form';
import { useEffect, useId, useState } from 'react';
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
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { setAdminUserPasswordServerFn } from '../server/admin-management';
import type { User } from '../types';

interface UserPasswordResetDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
}

function validatePassword(value: string) {
  const errors: string[] = [];

  if (!value) {
    errors.push('Password is required');
  } else if (value.length < 8) {
    errors.push('Password must be at least 8 characters long');
  } else if (value.length > 128) {
    errors.push('Password must be less than 128 characters');
  } else if (!/(?=.*[a-z])/.test(value)) {
    errors.push('Password must contain at least one lowercase letter');
  } else if (!/(?=.*[A-Z])/.test(value)) {
    errors.push('Password must contain at least one uppercase letter');
  } else if (!/(?=.*\d)/.test(value)) {
    errors.push('Password must contain at least one number');
  } else if (!/(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?])/.test(value)) {
    errors.push('Password must contain at least one symbol');
  }

  return errors[0];
}

export function UserPasswordResetDialog({ open, user, onClose }: UserPasswordResetDialogProps) {
  const { showToast } = useToast();
  const newPasswordId = useId();
  const confirmPasswordId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
    onSubmit: async ({ value }) => {
      if (!user) {
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        await setAdminUserPasswordServerFn({
          data: {
            userId: user.id,
            newPassword: value.newPassword,
          },
        });
        showToast('Password updated', 'success');
        onClose();
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to update password');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (!open) {
      setSubmitError(null);
      form.reset({
        newPassword: '',
        confirmPassword: '',
      });
    }
  }, [form, open]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {user?.email ?? 'this user'}.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="grid gap-4 py-4">
            <form.Field
              name="newPassword"
              validators={{
                onChange: ({ value }) => validatePassword(value),
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={newPasswordId}>New password</FieldLabel>
                  <Input
                    id={newPasswordId}
                    type="password"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Enter a strong password"
                  />
                  <p className="text-sm text-muted-foreground">
                    Password must contain 8+ characters, uppercase, lowercase, number, and symbol.
                  </p>
                  {field.state.meta.errors.length > 0 ? (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  ) : null}
                </Field>
              )}
            </form.Field>

            <form.Field
              name="confirmPassword"
              validators={{
                onChangeListenTo: ['newPassword'],
                onChange: ({ value, fieldApi }) => {
                  if (!value) {
                    return 'Please confirm the password';
                  }

                  if (value !== fieldApi.form.getFieldValue('newPassword')) {
                    return 'Passwords do not match';
                  }

                  return undefined;
                },
              }}
            >
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={confirmPasswordId}>Confirm password</FieldLabel>
                  <Input
                    id={confirmPasswordId}
                    type="password"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Re-enter the new password"
                  />
                  {field.state.meta.errors.length > 0 ? (
                    <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                  ) : null}
                </Field>
              )}
            </form.Field>

            {submitError ? (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit]}>
              {([canSubmit]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? 'Updating...' : 'Reset password'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
