import type { api } from '@convex/_generated/api';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { signOut } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { MetricCard, SkeletonCard } from './MetricCard';
import { RecentActivity } from './RecentActivity';

type DashboardData = typeof api.dashboard.getDashboardData._returnType;

type DashboardProps = {
  data: DashboardData;
  isLoading: boolean;
};

export function Dashboard({ data, isLoading }: DashboardProps) {
  const router = useRouter();
  const { isAdmin, isPending: authPending } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const shouldInvalidate = useMemo(
    () => !authPending && isAdmin && !isLoading && data === null,
    [authPending, isAdmin, isLoading, data],
  );

  useEffect(() => {
    if (shouldInvalidate) {
      void router.invalidate();
    }
  }, [router, shouldInvalidate]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
      router.navigate({ to: '/login', search: { redirect: '/app' } });
    }
  }, [router]);

  const stats = data?.stats ?? null;
  const activity = data?.activity ?? [];

  if (isLoading) {
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

        {/* Loading Metrics Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <SkeletonCard title="Total Users" />
          <SkeletonCard title="Active Users" />
          <SkeletonCard title="Recent Signups" />
        </div>

        {/* Loading Recent Activity */}
        <div className="bg-card rounded-lg border border-border p-6">
          <div className="animate-pulse">
            <div className="h-6 bg-muted rounded w-48 mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={`skeleton-${item}`} className="flex items-center space-x-4">
                  <div className="h-10 w-10 bg-muted rounded-full"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-3 bg-muted rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoading && data === null) {
    if (!isAdmin) {
      return (
        <div className="space-y-6">
          <PageHeader
            title="Dashboard"
            description="TanStack Start Template built with Better Auth, Convex, Tailwind CSS, Shadcn/UI, Resend, and deployed to Netlify."
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
                onClick={() => router.invalidate()}
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

      {/* Error Alert */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {stats ? (
          <MetricCard title="Total Users" value={stats.totalUsers.toLocaleString()} />
        ) : (
          <SkeletonCard title="Total Users" />
        )}

        {stats ? (
          <MetricCard title="Active Users" value={stats.activeUsers.toString()} />
        ) : (
          <SkeletonCard title="Active Users" />
        )}

        {/* New User Button */}
        {stats ? (
          <MetricCard title="Recent Signups" value={stats.recentSignups.toString()} />
        ) : (
          <SkeletonCard title="Recent Signups" />
        )}
      </div>

      {/* Recent Activity */}
      <RecentActivity activities={activity || []} />
    </div>
  );
}
