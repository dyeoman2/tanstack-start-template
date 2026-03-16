import {
  ChangePasswordCard,
  PasskeysCard,
  SessionsCard,
  TwoFactorCard,
} from '@daveyplate/better-auth-ui';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { signOut } from '~/features/auth/auth-client';
import { ProfileDetailsCard } from '~/features/profile/components/ProfileDetailsCard';
import { useProfile } from '~/features/profile/hooks/useProfile';
import { USER_ROLES } from '../../auth/types';

export function ProfilePage() {
  const { data: profile, isLoading, error } = useProfile();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (error?.message === 'UNAUTHORIZED') {
      void router.invalidate();
    }
  }, [error, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profile"
          description="Manage your account information, security, and app access."
        />

        <div className="space-y-4">
          <ProfileCardSkeleton />
          <ProfileCardSkeleton />
          <ProfileCardSkeleton />
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
        router.navigate({ to: '/login', search: { redirectTo: '/app/profile' } });
      }
    };

    return (
      <div className="space-y-6">
        <PageHeader
          title="Profile"
          description="Manage your account information, security, and app access."
        />

        <div>
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
        description="Manage your account information, security, and app access."
      />

      <div className="space-y-6">
        {profile.requiresMfaSetup ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader>
              <CardTitle>Finish multi-factor setup</CardTitle>
              <CardDescription>
                This starter now enforces regulated access controls. Enable an authenticator app or
                passkey before using the rest of the application.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section>
          <ProfileDetailsCard profile={profile} />
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">Security</h2>
            <p className="text-sm text-muted-foreground">
              Manage your password, authenticator app, passkeys, and active sessions.
            </p>
          </div>
          <div className="flex w-full flex-col gap-4">
            <ChangePasswordCard classNames={profilePasswordCardClassNames} />
            <TwoFactorCard classNames={profileSettingsCardClassNames} />
            <PasskeysCard classNames={profileSettingsCardClassNames} />
            <SessionsCard classNames={profileSettingsCardClassNames} />
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>App access</CardTitle>
            <CardDescription>
              Read-only account metadata used across this application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-sm font-medium text-foreground">Role</dt>
                <dd className="text-sm text-muted-foreground">
                  {profile.role === USER_ROLES.ADMIN ? 'Administrator' : 'User'}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-sm font-medium text-foreground">Created At</dt>
                <dd className="text-sm text-muted-foreground">
                  {new Date(profile.createdAt).toLocaleDateString()}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-sm font-medium text-foreground">Email</dt>
                <dd className="text-sm text-muted-foreground">{profile.email}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-sm font-medium text-foreground">Email Verified</dt>
                <dd className="text-sm text-muted-foreground">
                  {profile.emailVerified ? 'Verified' : 'Not verified'}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-sm font-medium text-foreground">MFA</dt>
                <dd className="text-sm text-muted-foreground">
                  {profile.mfaEnabled ? 'Enabled' : 'Setup required'}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-sm font-medium text-foreground">Recent step-up</dt>
                <dd className="text-sm text-muted-foreground">
                  {profile.recentStepUpValidUntil
                    ? `Valid until ${new Date(profile.recentStepUpValidUntil).toLocaleString()}`
                    : 'Expired'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProfileCardSkeleton() {
  return (
    <div className="rounded-xl border border-border p-6 shadow-sm">
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

const profileSettingsCardClassNames = {
  base: 'w-full gap-0 overflow-hidden rounded-xl border border-border shadow-sm',
  header: 'border-b',
  title: 'font-semibold leading-none text-base md:text-base',
  description: 'text-sm text-muted-foreground',
  content: 'px-6 py-6',
  footer: 'border-t border-border bg-muted/20 px-6 py-4',
  instructions: 'text-sm leading-6 text-muted-foreground text-left',
  input: 'h-10 rounded-md border-border bg-background shadow-none',
  label: 'text-sm font-medium text-foreground',
  primaryButton: 'h-9 px-4',
  secondaryButton: 'h-9 px-4',
  outlineButton: 'h-9 px-4',
  destructiveButton: 'h-9 px-4',
  button: 'h-9',
  cell: 'rounded-lg border border-border bg-background px-4 py-3',
  skeleton: 'bg-muted/70',
};

const profilePasswordCardClassNames = {
  ...profileSettingsCardClassNames,
  header: 'border-b',
  title: 'font-semibold leading-none text-base md:text-base',
  description: 'text-sm text-muted-foreground',
  content: 'py-6',
  footer:
    'flex-col items-stretch gap-4 border-t border-border bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between',
  instructions: 'text-sm leading-6 text-muted-foreground text-left sm:flex-1',
  button: 'h-9 sm:ms-0',
};
