import { useForm } from '@tanstack/react-form';
import { AlertCircleIcon, CheckCircle2Icon, EyeIcon, EyeOffIcon, Loader2 } from 'lucide-react';
import { type ComponentProps, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { useToast } from '~/components/ui/toast';
import { authClient, authHooks, useSession } from '~/features/auth/auth-client';

type SubmitState = {
  variant: 'success' | 'warning' | 'destructive';
  title: string;
  description: string;
} | null;

function getErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null &&
    'message' in error.error &&
    typeof error.error.message === 'string'
  ) {
    return error.error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Something went wrong while updating your password.';
}

function validatePassword(value: string) {
  if (!value) {
    return 'Password is required.';
  }

  if (value.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  if (value.length > 128) {
    return 'Password must be less than 128 characters.';
  }

  return undefined;
}

export function ProfileChangePasswordCard() {
  const { showToast } = useToast();
  const { data: sessionData } = useSession();
  const { data: accounts, isPending } = authHooks.useListAccounts();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const credentialsLinked = useMemo(
    () => accounts?.some((account) => account.provider === 'credential') ?? false,
    [accounts],
  );

  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    onSubmit: async ({ value, formApi }) => {
      setSubmitState(null);

      try {
        await authClient.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          revokeOtherSessions: true,
          fetchOptions: { throw: true },
        });

        formApi.reset();
        setSubmitState({
          variant: 'success',
          title: 'Password updated',
          description: 'Your password was updated and other sessions were revoked.',
        });
      } catch (error) {
        setSubmitState({
          variant: 'destructive',
          title: 'Unable to update password',
          description: getErrorMessage(error),
        });
      }
    },
  });

  const handleSendSetupLink = async () => {
    const email = sessionData?.user.email;

    if (!email) {
      showToast('Could not determine the current account email.', 'error');
      return;
    }

    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
        fetchOptions: { throw: true },
      });

      setSubmitState({
        variant: 'success',
        title: 'Setup link sent',
        description: 'Check your inbox for a link to create a password for this account.',
      });
    } catch (error) {
      setSubmitState({
        variant: 'destructive',
        title: 'Unable to send setup link',
        description: getErrorMessage(error),
      });
    }
  };

  if (!isPending && !credentialsLinked) {
    return (
      <Card className="w-full gap-0 overflow-hidden rounded-xl border border-border shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="font-semibold leading-none text-base md:text-base">
            Set Password
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Add a password so you can sign in without relying only on social or passkey access.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              We&apos;ll email you a secure link to create a password for this account.
            </p>
            <Button type="button" onClick={() => void handleSendSetupLink()}>
              Email setup link
            </Button>
          </div>
          {submitState ? (
            <Alert variant={submitState.variant} className="mt-4 py-3">
              {submitState.variant === 'destructive' || submitState.variant === 'warning' ? (
                <AlertCircleIcon />
              ) : (
                <CheckCircle2Icon />
              )}
              <AlertTitle>{submitState.title}</AlertTitle>
              <AlertDescription>{submitState.description}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full gap-0 overflow-hidden rounded-xl border border-border shadow-sm">
        <CardHeader className="border-b">
          <CardTitle className="font-semibold leading-none text-base md:text-base">
            Password
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Update your password and revoke your other sessions when it changes.
          </CardDescription>
        </CardHeader>

        <CardContent className="py-6">
          <div className="flex justify-start">
            <Button type="button" onClick={() => setIsDialogOpen(true)}>
              Change password
            </Button>
          </div>

          {submitState ? (
            <Alert variant={submitState.variant} className="mt-4 py-3">
              {submitState.variant === 'destructive' || submitState.variant === 'warning' ? (
                <AlertCircleIcon />
              ) : (
                <CheckCircle2Icon />
              )}
              <AlertTitle>{submitState.title}</AlertTitle>
              <AlertDescription>{submitState.description}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);

          if (!open) {
            form.reset();
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmPassword(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Enter your current password and a new password. Other sessions will be revoked after
              the update.
            </DialogDescription>
          </DialogHeader>

          <form
            id="profile-change-password-form"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup className="gap-5 py-2">
              <form.Field
                name="currentPassword"
                validators={{
                  onChange: ({ value }) => validatePassword(value),
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 ? true : undefined}>
                    <FieldContent>
                      <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                      <PasswordField
                        id="current-password"
                        autoComplete="current-password"
                        placeholder="Current password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        visible={showCurrentPassword}
                        onToggleVisibility={() => setShowCurrentPassword((value) => !value)}
                      />
                      <FieldError>{field.state.meta.errors[0]}</FieldError>
                    </FieldContent>
                  </Field>
                )}
              </form.Field>

              <form.Field
                name="newPassword"
                validators={{
                  onChange: ({ value }) => validatePassword(value),
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 ? true : undefined}>
                    <FieldContent>
                      <FieldLabel htmlFor="new-password">New password</FieldLabel>
                      <PasswordField
                        id="new-password"
                        autoComplete="new-password"
                        placeholder="New password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        visible={showNewPassword}
                        onToggleVisibility={() => setShowNewPassword((value) => !value)}
                      />
                      <p className="text-sm text-muted-foreground">Use at least 8 characters.</p>
                      <FieldError>{field.state.meta.errors[0]}</FieldError>
                    </FieldContent>
                  </Field>
                )}
              </form.Field>

              <form.Field
                name="confirmPassword"
                validators={{
                  onChangeListenTo: ['newPassword'],
                  onChange: ({ value, fieldApi }) => {
                    if (!value) {
                      return 'Please confirm your new password.';
                    }

                    if (value !== fieldApi.form.getFieldValue('newPassword')) {
                      return 'Passwords do not match.';
                    }

                    return undefined;
                  },
                }}
              >
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 ? true : undefined}>
                    <FieldContent>
                      <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                      <PasswordField
                        id="confirm-password"
                        autoComplete="new-password"
                        placeholder="Confirm new password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        visible={showConfirmPassword}
                        onToggleVisibility={() => setShowConfirmPassword((value) => !value)}
                      />
                      <FieldError>{field.state.meta.errors[0]}</FieldError>
                    </FieldContent>
                  </Field>
                )}
              </form.Field>
            </FieldGroup>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isPristine, state.isSubmitting]}
            >
              {([canSubmit, isPristine, isSubmitting]) => (
                <Button
                  type="submit"
                  form="profile-change-password-form"
                  disabled={isPending || !canSubmit || isPristine || isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Saving
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PasswordField({
  visible,
  onToggleVisibility,
  ...props
}: ComponentProps<typeof InputGroupInput> & {
  visible: boolean;
  onToggleVisibility: () => void;
}) {
  return (
    <InputGroup>
      <InputGroupInput type={visible ? 'text' : 'password'} {...props} />
      <InputGroupAddon align="inline-end">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center"
          onClick={onToggleVisibility}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </InputGroupAddon>
    </InputGroup>
  );
}
