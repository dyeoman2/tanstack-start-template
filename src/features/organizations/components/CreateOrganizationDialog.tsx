import { api } from '@convex/_generated/api';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';
import { generateOrganizationSlug } from '~/features/organizations/lib/organization-slug';
import {
  checkOrganizationSlugServerFn,
  createOrganizationServerFn,
} from '~/features/organizations/server/organization-management';

interface CreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateOrganizationDialog({ open, onOpenChange }: CreateOrganizationDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const eligibility = useQuery(api.organizationManagement.getOrganizationCreationEligibility, {});
  const createOrganization = createOrganizationServerFn;
  const checkOrganizationSlug = checkOrganizationSlugServerFn;
  const canCreate = eligibility?.canCreate ?? false;
  const creationReason = eligibility?.reason ?? null;
  const isEligibilityPending = eligibility === undefined;
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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
        const slug = generateOrganizationSlug(name);
        const slugCheck = await checkOrganizationSlug({
          data: { slug },
        });
        if (!slugCheck.available) {
          const message = 'That organization URL is already in use. Try a different name.';
          setSubmitError(message);
          showToast(message, 'error');
          return;
        }

        const organization = await createOrganization({
          data: {
            name,
            slug: slugCheck.slug,
          },
        });
        await refreshOrganizationClientState(queryClient, {
          invalidateRouter: async () => {
            await router.invalidate();
          },
        });

        onOpenChange(false);
        form.reset();
        showToast('Organization created successfully.', 'success');

        await navigate({
          to: '/app/organizations/$slug/settings',
          params: { slug: organization.slug },
          state: {
            organizationBreadcrumb: {
              name: organization.name,
              slug: organization.slug,
            },
          },
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
      nameInputRef.current?.focus();
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
                  ref={nameInputRef}
                  id="organization-name"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Cottage Hospital"
                  disabled={form.state.isSubmitting}
                />
                <FieldError>
                  {field.state.meta.isTouched ? field.state.meta.errors[0] : undefined}
                </FieldError>
              </Field>
            )}
          </form.Field>

          {submitError ? <FieldError>{submitError}</FieldError> : null}
          {creationReason ? (
            <p className="text-sm text-muted-foreground">{creationReason}</p>
          ) : null}

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
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting || isEligibilityPending || !canCreate}
                >
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Failed to create organization';
}
