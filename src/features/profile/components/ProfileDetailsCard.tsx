'use client';

import { useForm } from '@tanstack/react-form';
import { AlertCircleIcon, CheckCircle2Icon, SaveIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { Spinner } from '~/components/ui/spinner';
import { authClient } from '~/features/auth/auth-client';
import type { ProfileData } from '~/features/profile/hooks/useProfile';

const nameMaxLength = 32;

type SubmitState = {
  variant: 'success' | 'warning' | 'destructive';
  title: string;
  description: string;
} | null;

interface ProfileDetailsCardProps {
  profile: ProfileData;
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10);

  if (digits.length >= 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length >= 4) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  if (digits.length > 0) {
    return `(${digits}`;
  }

  return '';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Something went wrong while saving your profile.';
}

function validateName(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 'Name is required.';
  }

  if (trimmedValue.length > nameMaxLength) {
    return `Please use ${nameMaxLength} characters at maximum.`;
  }

  return undefined;
}

function validateEmail(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 'Email is required.';
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(trimmedValue)) {
    return 'Please enter a valid email address.';
  }

  return undefined;
}

function validatePhoneNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  if (value.replace(/\D/g, '').length !== 10) {
    return 'Please enter a valid phone number.';
  }

  return undefined;
}

export function ProfileDetailsCard({ profile }: ProfileDetailsCardProps) {
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const [submitState, setSubmitState] = useState<SubmitState>(null);
  const defaultValues = useMemo(
    () => ({
      name: profile.name ?? '',
      email: profile.email,
      phoneNumber: formatPhoneNumber(profile.phoneNumber ?? ''),
    }),
    [profile.name, profile.email, profile.phoneNumber],
  );

  const form = useForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      const nextName = value.name.trim();
      const nextEmail = value.email.trim().toLowerCase();
      const nextPhoneNumber = value.phoneNumber.trim();

      const updates = {
        name: nextName,
        email: nextEmail,
        phoneNumber: nextPhoneNumber,
      };

      const currentValues = {
        name: profile.name ?? '',
        email: profile.email.trim().toLowerCase(),
        phoneNumber: formatPhoneNumber(profile.phoneNumber ?? ''),
      };

      const changedProfileFields = {
        ...(updates.name !== currentValues.name ? { name: updates.name } : {}),
        ...(updates.phoneNumber !== currentValues.phoneNumber
          ? { phoneNumber: updates.phoneNumber === '' ? null : updates.phoneNumber }
          : {}),
      };
      const emailChanged = updates.email !== currentValues.email;

      if (Object.keys(changedProfileFields).length === 0 && !emailChanged) {
        setSubmitState({
          variant: 'warning',
          title: 'No changes to save',
          description: 'Update a field before saving your profile details.',
        });
        return;
      }

      setSubmitState(null);

      const operations = await Promise.allSettled([
        ...(Object.keys(changedProfileFields).length > 0
          ? [
              authClient.updateUser({
                ...changedProfileFields,
                fetchOptions: { throw: true },
              }),
            ]
          : []),
        ...(emailChanged
          ? [
              authClient.changeEmail({
                newEmail: updates.email,
                callbackURL: '/app/profile',
                fetchOptions: { throw: true },
              }),
            ]
          : []),
      ]);

      const failures = operations.filter((result) => result.status === 'rejected');

      if (failures.length === 0) {
        formApi.reset({
          name: updates.name,
          email: updates.email,
          phoneNumber: updates.phoneNumber,
        });
        setSubmitState({
          variant: 'success',
          title: 'Profile updated',
          description: emailChanged
            ? 'Your changes were saved. Check your inbox to confirm the new email address.'
            : 'Your profile details were saved successfully.',
        });
        return;
      }

      if (failures.length < operations.length) {
        setSubmitState({
          variant: 'warning',
          title: 'Profile partially updated',
          description: failures.map((result) => getErrorMessage(result.reason)).join(' '),
        });
        return;
      }

      setSubmitState({
        variant: 'destructive',
        title: 'Unable to save profile',
        description: getErrorMessage(failures[0]?.reason),
      });
    },
  });

  useEffect(() => {
    form.reset(defaultValues);
    setSubmitState(null);
  }, [form, defaultValues]);

  return (
    <Card className="w-full gap-0">
      <CardHeader className="border-b">
        <CardTitle>Account Details</CardTitle>
        <CardDescription>
          Update your display name, sign-in email, and phone number from one place.
        </CardDescription>
      </CardHeader>
      <CardContent className="py-6">
        <form
          id="profile-details-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup className="gap-5">
            <form.Field
              name="name"
              validators={{
                onChange: ({ value }) => validateName(value),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0 ? true : undefined}>
                  <FieldContent>
                    <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                    <Input
                      id={nameId}
                      autoComplete="name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </FieldContent>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="email"
              validators={{
                onChange: ({ value }) => validateEmail(value),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0 ? true : undefined}>
                  <FieldContent>
                    <FieldLabel htmlFor={emailId}>Email</FieldLabel>
                    <Input
                      id={emailId}
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </FieldContent>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="phoneNumber"
              validators={{
                onChange: ({ value }) => validatePhoneNumber(value),
              }}
            >
              {(field) => (
                <Field data-invalid={field.state.meta.errors.length > 0 ? true : undefined}>
                  <FieldContent>
                    <FieldLabel htmlFor={phoneId}>Phone number</FieldLabel>
                    <Input
                      id={phoneId}
                      type="tel"
                      autoComplete="tel"
                      placeholder="(805) 123-4567"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(formatPhoneNumber(event.target.value))
                      }
                    />
                    <FieldError>{field.state.meta.errors[0]}</FieldError>
                  </FieldContent>
                </Field>
              )}
            </form.Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-4 border-t sm:flex-row sm:items-center sm:justify-between">
        {submitState ? (
          <Alert variant={submitState.variant} className="py-3 sm:flex-1">
            {submitState.variant === 'destructive' || submitState.variant === 'warning' ? (
              <AlertCircleIcon />
            ) : (
              <CheckCircle2Icon />
            )}
            <AlertTitle>{submitState.title}</AlertTitle>
            <AlertDescription>{submitState.description}</AlertDescription>
          </Alert>
        ) : null}
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isPristine, state.isSubmitting]}
        >
          {([canSubmit, isPristine, isSubmitting]) => (
            <Button
              type="submit"
              form="profile-details-form"
              disabled={!canSubmit || isPristine || isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Saving
                </>
              ) : (
                <>
                  <SaveIcon data-icon="inline-start" />
                  Save changes
                </>
              )}
            </Button>
          )}
        </form.Subscribe>
      </CardFooter>
    </Card>
  );
}
