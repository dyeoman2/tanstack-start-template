import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
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
import { Field, FieldError, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { useToast } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';

interface CreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrganizationDialog({ open, onOpenChange }: CreateOrganizationDialogProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: '',
    },
    onSubmit: async ({ value }) => {
      const name = value.name.trim();
      if (!name) {
        return;
      }

      setSubmitError(null);

      try {
        const organization = await authClient.organization.create({
          name,
          slug: generateOrganizationSlug(name),
          fetchOptions: { throw: true },
        });

        onOpenChange(false);
        form.reset();
        showToast('Organization created successfully.', 'success');

        await navigate({
          to: '/app/organizations/$slug/settings',
          params: { slug: organization.slug },
        });
      } catch (error) {
        const message = getErrorMessage(error);
        setSubmitError(message);
        showToast(message, 'error');
      }
    },
  });

  useEffect(() => {
    if (open) {
      return;
    }

    setSubmitError(null);
    form.reset();
  }, [form, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Add an organization name. The URL slug will be created automatically.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-6"
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => {
                const name = value.trim();
                if (!name) {
                  return 'Organization name is required';
                }

                if (name.length > 32) {
                  return 'Organization name must be 32 characters or fewer';
                }

                return undefined;
              },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel htmlFor="organization-name">Name</FieldLabel>
                <Input
                  id="organization-name"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Cottage Hospital"
                  disabled={form.state.isSubmitting}
                  autoFocus
                />
                <FieldError>
                  {field.state.meta.isTouched ? field.state.meta.errors[0] : undefined}
                </FieldError>
              </Field>
            )}
          </form.Field>

          {submitError ? <FieldError>{submitError}</FieldError> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={form.state.isSubmitting}
            >
              Cancel
            </Button>

            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create organization'
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

function generateOrganizationSlug(name: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const base = slugify(name) || 'organization';
  const maxBaseLength = Math.max(1, 48 - suffix.length - 1);

  return `${base.slice(0, maxBaseLength)}-${suffix}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Failed to create organization';
}
