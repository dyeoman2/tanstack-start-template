import { api } from '@convex/_generated/api';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AppSidebar } from '~/components/AppSidebar';
import { ThemeToggle } from '~/components/theme-toggle';
import { Button } from '~/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import { useToast } from '~/components/ui/toast';
import { authClient } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { cn } from '~/lib/utils';

type BreadcrumbPart = {
  href?: string;
  key: string;
  label: ReactNode;
};

const routeLabels = new Map<string, string>([
  ['admin', 'Admin'],
  ['ai-playground', 'AI Playground'],
  ['chat', 'Chat'],
  ['members', 'Members'],
  ['organizations', 'Organizations'],
  ['profile', 'Profile'],
  ['settings', 'Settings'],
  ['stats', 'Stats'],
  ['teams', 'Teams'],
  ['users', 'Users'],
]);

function formatSegment(segment: string) {
  return (
    routeLabels.get(segment) ??
    decodeURIComponent(segment)
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function getBreadcrumbs(pathname: string): BreadcrumbPart[] {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] !== 'app') {
    return [];
  }

  if (segments.length === 1) {
    return [{ key: 'dashboard', label: 'Dashboard' }];
  }

  return [
    { href: '/app', key: 'dashboard', label: 'Dashboard' },
    ...segments.slice(1).map((segment, index, childSegments) => {
      const href = `/app/${childSegments.slice(0, index + 1).join('/')}`;
      const isLast = index === childSegments.length - 1;
      const previousSegment = childSegments[index - 1];
      const fallbackLabel = previousSegment === 'chat' ? 'Conversation' : formatSegment(segment);

      return {
        key: href,
        href: isLast ? undefined : href,
        label:
          previousSegment === 'organizations' ? (
            <OrganizationBreadcrumbLabel slug={segment} fallback={fallbackLabel} />
          ) : previousSegment === 'chat' ? (
            <ChatThreadBreadcrumbLabel threadId={segment} fallback={fallbackLabel} />
          ) : (
            fallbackLabel
          ),
      };
    }),
  ];
}

function OrganizationBreadcrumbLabel({ fallback, slug }: { fallback: string; slug: string }) {
  const organization = useQuery(api.organizationManagement.getOrganizationSettings, { slug });

  return organization?.organization.name ?? fallback;
}

function ChatThreadBreadcrumbLabel({
  fallback,
  threadId,
}: {
  fallback: string;
  threadId: string;
}) {
  const threads = useQuery(api.chat.listThreads, {});
  const thread = threads?.find((item) => item._id === threadId);

  return thread?.title ?? fallback;
}

function AppBreadcrumbs() {
  const location = useLocation();
  const items = getBreadcrumbs(location.pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <BreadcrumbItem key={item.key}>
              {item.href && !isLast ? (
                <BreadcrumbLink
                  asChild
                  className={cn(index < items.length - 2 && 'hidden md:inline')}
                >
                  <Link to={item.href}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
              {!isLast && (
                <BreadcrumbSeparator
                  className={cn(index < items.length - 2 && 'hidden md:inline-flex')}
                />
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function AuthenticatedAppShell({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const { isImpersonating, isPending, isSiteAdmin, user } = useAuth();
  const [isStoppingImpersonation, setIsStoppingImpersonation] = useState(false);
  const [isRestoringAdminContext, setIsRestoringAdminContext] = useState(false);
  const isChatRoute = location.pathname === '/app/chat' || location.pathname.startsWith('/app/chat/');

  useEffect(() => {
    if (!isRestoringAdminContext || isPending || isImpersonating || !isSiteAdmin) {
      return;
    }

    setIsRestoringAdminContext(false);

    if (location.pathname === '/app/admin/users') {
      return;
    }

    void navigate({
      to: '/app/admin/users',
      replace: true,
    }).then(() => router.invalidate());
  }, [
    isImpersonating,
    isPending,
    isRestoringAdminContext,
    isSiteAdmin,
    location.pathname,
    navigate,
    router,
  ]);

  const handleStopImpersonating = async () => {
    setIsStoppingImpersonation(true);

    try {
      await authClient.admin.stopImpersonating({
        fetchOptions: { throw: true },
      });
      const session = await authClient.getSession({
        fetchOptions: { throw: true },
      });

      authClient.$store.notify('$sessionSignal');
      queryClient.setQueryData(['session'], session);
      setIsRestoringAdminContext(true);
      await navigate({ to: '/app', replace: true });
      await router.invalidate();
    } catch (error) {
      setIsRestoringAdminContext(false);
      showToast(getErrorMessage(error, 'Failed to stop impersonation'), 'error');
    } finally {
      setIsStoppingImpersonation(false);
    }
  };

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        {isImpersonating ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium">
                You are impersonating {user?.email ?? 'this user'}.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleStopImpersonating();
                }}
                disabled={isStoppingImpersonation}
              >
                {isStoppingImpersonation ? <Loader2 className="size-4 animate-spin" /> : null}
                Stop impersonating
              </Button>
            </div>
          </div>
        ) : null}
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex w-full items-center gap-3 px-4">
            <SidebarTrigger className="-ml-1" />
            <div className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
            <AppBreadcrumbs />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden p-4 pt-0',
            isChatRoute ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {isChatRoute ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
