import { useForm } from '@tanstack/react-form';
import { useRouter } from '@tanstack/react-router';
import { Edit, Mail, Phone } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupIcon,
  InputGroupInput,
} from '~/components/ui/input-group';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { signOut } from '~/features/auth/auth-client';
import { useProfile, useUpdateProfile } from '~/features/profile/hooks/useProfile';
import { usePhoneFormatter } from '~/hooks/use-phone-formatter';
import { cn } from '~/lib/utils';
import { USER_ROLES } from '../../auth/types';

// Form validation schema
const profileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  phoneNumber: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export function ProfilePage() {
  const [isEditing, setIsEditing] = useState(false);
  const { data: profile, isLoading, error } = useProfile();
  const updateProfile = useUpdateProfile();
  const phoneFormatter = usePhoneFormatter();
  const toast = useToast();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Generate unique IDs for form fields
  const emailId = useId();
  const nameId = useId();
  const phoneId = useId();

  const form = useForm({
    defaultValues: {
      name: profile?.name || '',
      phoneNumber: profile?.phoneNumber || '',
    } as ProfileFormData,
    onSubmit: async ({ value }) => {
      try {
        await updateProfile.mutateAsync(value);
        setIsEditing(false);
        form.reset();
        toast.showToast('Profile updated successfully!', 'success');
      } catch (error) {
        console.error('Failed to update profile:', error);
        toast.showToast('Failed to update profile. Please try again.', 'error');
      }
    },
  });

  // Update form values when profile data loads or when exiting edit mode
  useEffect(() => {
    if (profile && !isEditing) {
      form.reset({
        name: profile.name || '',
        phoneNumber: profile.phoneNumber || '',
      });
    }
    // Only reset when profile changes AND we're not editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.name, profile?.phoneNumber, isEditing, form.reset, profile]);

  useEffect(() => {
    if (error?.message === 'UNAUTHORIZED') {
      void router.invalidate();
    }
  }, [error, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64 mt-2" />
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto space-y-6">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    const handleSignOut = async () => {
      setIsSigningOut(true);
      try {
        await signOut();
      } finally {
        setIsSigningOut(false);
        router.navigate({ to: '/login', search: { redirect: '/app/profile' } });
      }
    };

    return (
      <div className="space-y-6">
        <PageHeader
          title="Profile"
          description="Manage your account information and preferences."
        />

        <div className="max-w-2xl mx-auto">
          <div className="bg-destructive/10 border border-destructive rounded-md p-6">
            <div className="space-y-3">
              <div>
                <h3 className="text-lg font-medium text-destructive mb-1">Error loading profile</h3>
                <p className="text-sm text-destructive">
                  {error?.message === 'UNAUTHORIZED'
                    ? 'Your session may have changed. Try refreshing or sign back in.'
                    : 'Failed to load your profile information.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="default" size="sm" onClick={() => router.invalidate()}>
                  Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
                  {isSigningOut ? 'Signing out…' : 'Sign out'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        description="Manage your account information and preferences."
        actions={
          !isEditing && (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4 mx-auto"
      >
        {/* Name */}
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel>Full Name</FieldLabel>
              <Input
                id={nameId}
                type="text"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled={!isEditing}
                className={cn(!isEditing && 'bg-muted')}
                placeholder="Enter your full name"
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
              )}
            </Field>
          )}
        </form.Field>

        {/* Email - Read Only */}
        <Field orientation="vertical">
          <FieldLabel>Email Address</FieldLabel>
          <InputGroup>
            <InputGroupIcon>
              <Mail />
            </InputGroupIcon>
            <InputGroupInput
              id={emailId}
              type="email"
              value={profile.email}
              disabled
              className="bg-muted"
            />
          </InputGroup>
          <FieldDescription>
            Email cannot be changed. Contact support if you need to update your email address.
          </FieldDescription>
        </Field>

        {/* Phone Number */}
        <form.Field name="phoneNumber">
          {(field) => (
            <Field orientation="vertical">
              <FieldLabel>Phone Number</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Phone />
                </InputGroupAddon>
                <InputGroupInput
                  id={phoneId}
                  type="tel"
                  value={field.state.value}
                  onChange={(e) => {
                    const formatted = phoneFormatter.formatInput(e.target.value);
                    field.handleChange(formatted);
                  }}
                  disabled={!isEditing}
                  className={cn(!isEditing && 'bg-muted')}
                  placeholder="(805) 123-4567"
                />
              </InputGroup>
            </Field>
          )}
        </form.Field>

        {/* Read-only fields */}
        <div className="grid grid-cols-2 gap-4">
          <Field orientation="vertical">
            <FieldLabel>Role</FieldLabel>
            <Input
              value={profile.role === USER_ROLES.ADMIN ? 'Administrator' : 'User'}
              disabled
              className="bg-muted capitalize"
            />
          </Field>
          <Field orientation="vertical">
            <FieldLabel>Created At</FieldLabel>
            <Input
              value={new Date(profile.createdAt).toLocaleDateString()}
              disabled
              className="bg-muted"
            />
          </Field>
        </div>

        {/* Form Actions */}
        {isEditing && (
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={!canSubmit || isSubmitting} className="flex-1">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false);
                    form.reset();
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            )}
          </form.Subscribe>
        )}
      </form>
    </div>
  );
}
