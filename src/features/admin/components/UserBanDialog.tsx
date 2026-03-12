import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, ShieldCheck } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Textarea } from '~/components/ui/textarea';
import { banAdminUserServerFn, unbanAdminUserServerFn } from '../server/admin-management';
import type { User } from '../types';

interface UserBanDialogProps {
  open: boolean;
  user: User | null;
  onClose: () => void;
}

const BAN_DURATION_OPTIONS = [
  { label: 'Permanent', value: 'permanent' },
  { label: '1 hour', value: String(60 * 60) },
  { label: '1 day', value: String(24 * 60 * 60) },
  { label: '7 days', value: String(7 * 24 * 60 * 60) },
  { label: '30 days', value: String(30 * 24 * 60 * 60) },
] as const;

function formatBanExpiry(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

export function UserBanDialog({ open, user, onClose }: UserBanDialogProps) {
  const queryClient = useQueryClient();
  const banReasonId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isUnbanMode = user?.banned === true;
  const formattedExpiry = formatBanExpiry(user?.banExpires ?? null);

  const form = useForm({
    defaultValues: {
      banReason: '',
      banExpiresIn: 'permanent',
    },
    onSubmit: async ({ value }) => {
      if (!user) {
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        if (isUnbanMode) {
          await unbanAdminUserServerFn({
            data: {
              userId: user.id,
            },
          });
        } else {
          const trimmedReason = value.banReason.trim();
          await banAdminUserServerFn({
            data: {
              userId: user.id,
              banReason: trimmedReason.length > 0 ? trimmedReason : undefined,
              banExpiresIn:
                value.banExpiresIn === 'permanent'
                  ? undefined
                  : Number.parseInt(value.banExpiresIn, 10),
            },
          });
        }

        await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
        onClose();
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to update user ban state');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (!open) {
      setSubmitError(null);
      form.reset({
        banReason: '',
        banExpiresIn: 'permanent',
      });
    }
  }, [form, open]);

  const dialogCopy = useMemo(() => {
    if (!user) {
      return {
        title: 'Update Ban',
        description: '',
        confirmLabel: 'Save',
      };
    }

    if (isUnbanMode) {
      return {
        title: `Unban ${user.email}`,
        description: 'Restore this user’s access to the application.',
        confirmLabel: 'Unban user',
      };
    }

    return {
      title: `Ban ${user.email}`,
      description: 'Block this user from accessing the application.',
      confirmLabel: 'Ban user',
    };
  }, [isUnbanMode, user]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isUnbanMode ? <ShieldCheck className="size-5" /> : <Ban className="size-5" />}
            {dialogCopy.title}
          </DialogTitle>
          <DialogDescription>{dialogCopy.description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="grid gap-4 py-4">
            {isUnbanMode ? (
              <Alert>
                <AlertTriangle className="size-4" />
                <AlertDescription>
                  {user?.banReason ? `Reason: ${user.banReason}. ` : ''}
                  {formattedExpiry ? `Ban expires ${formattedExpiry}.` : 'This ban is permanent.'}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <form.Field name="banReason">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={banReasonId}>Ban reason</FieldLabel>
                      <Textarea
                        id={banReasonId}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="Optional reason shown to admins"
                        rows={4}
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="banExpiresIn">
                  {(field) => (
                    <Field>
                      <FieldLabel>Ban duration</FieldLabel>
                      <Select value={field.state.value} onValueChange={field.handleChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                          {BAN_DURATION_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
                <Alert>
                  <AlertDescription>
                    Permanent bans never expire. Temporary bans are enforced until the selected
                    duration elapses.
                  </AlertDescription>
                </Alert>
              </>
            )}

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
            <Button
              type="submit"
              variant={isUnbanMode ? 'default' : 'destructive'}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? isUnbanMode
                  ? 'Unbanning...'
                  : 'Banning...'
                : dialogCopy.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
