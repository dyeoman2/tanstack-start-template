import type { api } from '@convex/_generated/api';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { signOut } from '~/features/auth/auth-client';
import { MetricCard } from './MetricCard';

type DashboardData = typeof api.dashboard.getDashboardData._returnType;

type DashboardProps = {
  data: DashboardData | null;
  isLoading: boolean;
};

export function Dashboard({ data, isLoading }: DashboardProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
      await router.navigate({ to: '/login', search: { redirectTo: '/app' } });
    }
  }

  if (isLoading || data === null) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description={
            <>
              TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI,
              Resend, and deployed to Netlify.
            </>
          }
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <MetricCard title="Total Users" isLoading />
          <MetricCard title="Active Users" isLoading />
          <MetricCard title="Recent Signups" isLoading />
        </div>
      </div>
    );
  }

  if (data.status === 'forbidden') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description={
            'TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI, Resend, and deployed to Netlify.'
          }
        />

        <div className="bg-muted border border-border rounded-md p-6">
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-foreground">Limited access</h3>
              <p>
                Your account does not have admin permissions, so the dashboard metrics are
                unavailable. If you believe you should have access, contact an administrator.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
                {isSigningOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (data.status === 'unauthenticated') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI, Resend, and deployed to Netlify."
        />

        <div className="bg-muted border border-border rounded-md p-6">
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-foreground">
                We couldn&apos;t load your dashboard data
              </h3>
              <p>
                This can happen if your session changed or your account no longer has access. Try
                refreshing, or sign back in to continue.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="default"
                size="sm"
                onClick={() => void router.invalidate()}
                disabled={isSigningOut}
              >
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
                {isSigningOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={
          <>
            TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI, Resend,
            and deployed to Netlify.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <MetricCard title="Total Users" value={stats.totalUsers.toLocaleString()} />
        <MetricCard title="Active Users" value={stats.activeUsers.toString()} />
        <MetricCard title="Recent Signups" value={stats.recentSignups.toString()} />
      </div>
    </div>
  );
}
