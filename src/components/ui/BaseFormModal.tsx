import { useForm } from '@tanstack/react-form';
import { type UseMutationOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Spinner } from '~/components/ui/spinner';

interface BaseFormModalProps<TFormData = Record<string, unknown>> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultValues: TFormData;
  onSubmit: (data: TFormData) => Promise<unknown>;
  onSuccess?: (result?: unknown) => void;
  onError?: (error: Error) => void;
  submitButtonText?: string;
  cancelButtonText?: string;
  maxWidth?: string;
  maxHeight?: string;
  // Query invalidation options
  invalidateQueries?: Array<{
    queryKey: readonly unknown[];
    exact?: boolean;
  }>;
  // Mutation options
  mutationOptions?: Omit<
    UseMutationOptions<unknown, Error, TFormData>,
    'mutationFn' | 'onSuccess' | 'onError'
  >;
}

export function BaseFormModal<TFormData = Record<string, unknown>>({
  open,
  onOpenChange,
  title,
  description,
  children,
  defaultValues,
  onSubmit,
  onSuccess,
  onError,
  submitButtonText = 'Save',
  cancelButtonText = 'Cancel',
  maxWidth = 'max-w-2xl',
  maxHeight = 'max-h-[90vh]',
  invalidateQueries = [],
  mutationOptions,
}: BaseFormModalProps<TFormData>) {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setErrorMessage(null);
      mutation.mutate(value);
    },
  });

  const mutation = useMutation({
    mutationFn: onSubmit,
    ...mutationOptions,
    onSuccess: (result) => {
      // Invalidate specified queries
      invalidateQueries.forEach(({ queryKey, exact = true }) => {
        queryClient.invalidateQueries({ queryKey, exact });
      });

      onSuccess?.(result);

      // Reset form and close modal
      form.reset();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'An error occurred');
      onError?.(error);
    },
  });

  const handleCancel = () => {
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${maxWidth} ${maxHeight} overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          {children}

          {errorMessage && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={mutation.isPending}
            >
              {cancelButtonText}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Spinner className="mr-2" />
                  Saving...
                </>
              ) : (
                submitButtonText
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
