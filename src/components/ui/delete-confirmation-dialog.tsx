import { useForm } from '@tanstack/react-form';
import { AlertTriangle } from 'lucide-react';
import * as React from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

type DeleteButtonContent = string | React.ReactNode;

export interface DeleteConfirmationDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when the dialog should close */
  onClose: () => void;
  /** Title of the dialog */
  title: string;
  /** Description text */
  description: string;
  /** Optional additional content to show in the dialog body */
  children?: React.ReactNode;
  /** The confirmation phrase that must be typed (optional) */
  confirmationPhrase?: string;
  /** Placeholder text for the confirmation input */
  confirmationPlaceholder?: string;
  /** Text for the cancel button */
  cancelText?: string;
  /** Text for the delete button */
  deleteText?: DeleteButtonContent;
  /** Whether the delete operation is in progress */
  isDeleting?: boolean;
  /** Error message to display */
  error?: string;
  /** Callback when delete is confirmed */
  onConfirm: () => void;
  /** Whether this is a dangerous operation (affects styling) */
  variant?: 'normal' | 'danger';
}

export function DeleteConfirmationDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmationPhrase,
  confirmationPlaceholder,
  cancelText = 'Cancel',
  deleteText = 'Delete',
  isDeleting = false,
  error,
  onConfirm,
  variant = 'normal',
}: DeleteConfirmationDialogProps) {
  const confirmationId = React.useId();

  const requiresConfirmation = Boolean(confirmationPhrase);

  const form = useForm({
    defaultValues: {
      confirmation: '',
    },
    onSubmit: async () => {
      onConfirm();
    },
  });

  const handleClose = () => {
    onClose();
    form.reset();
  };

  const isDestructive = variant === 'danger';

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={isDestructive ? 'text-destructive' : ''}>
            {isDestructive && <AlertTriangle className="inline h-5 w-5 mr-2" />}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {requiresConfirmation ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <div className="grid gap-4 pb-4">
              {children}
              <form.Field
                name="confirmation"
                validators={{
                  onChange: ({ value }) => {
                    if (value !== confirmationPhrase) {
                      return `Please type ${confirmationPhrase} to confirm`;
                    }
                    return undefined;
                  },
                }}
              >
                {(field) => (
                  <Field>
                    <FieldLabel>Confirm</FieldLabel>
                    <Input
                      id={confirmationId}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder={confirmationPlaceholder || confirmationPhrase}
                    />
                    <p className="text-sm text-muted-foreground">
                      Please type <strong>{confirmationPhrase}</strong> to confirm deletion.
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
                    )}
                  </Field>
                )}
              </form.Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleClose}>{cancelText}</AlertDialogCancel>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit]) => (
                  <AlertDialogAction
                    type="submit"
                    className={cn(
                      isDestructive &&
                        'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                    )}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      form.handleSubmit();
                    }}
                    disabled={!canSubmit || isDeleting}
                  >
                    {isDeleting ? 'Deleting...' : deleteText}
                  </AlertDialogAction>
                )}
              </form.Subscribe>
            </AlertDialogFooter>
          </form>
        ) : (
          <>
            <div className="pb-4">{children}</div>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleClose}>{cancelText}</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                className={cn(
                  isDestructive &&
                    'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onConfirm();
                }}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : deleteText}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

DeleteConfirmationDialog.displayName = 'DeleteConfirmationDialog';
