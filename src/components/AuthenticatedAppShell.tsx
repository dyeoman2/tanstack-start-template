import { useCurrentOrganization } from '@daveyplate/better-auth-ui';
import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppSidebar } from '~/components/AppSidebar';
import { ThemeToggle } from '~/components/theme-toggle';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb';
import { Separator } from '~/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';
import { cn } from '~/lib/utils';

type BreadcrumbPart = {
  href?: string;
  key: string;
  label: ReactNode;
};

const routeLabels = new Map<string, string>([
  ['admin', 'Admin'],
  ['ai-playground', 'AI Playground'],
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
      const fallbackLabel = formatSegment(segment);

      return {
        key: href,
        href: isLast ? undefined : href,
        label:
          previousSegment === 'organizations' ? (
            <OrganizationBreadcrumbLabel slug={segment} fallback={fallbackLabel} />
          ) : (
            fallbackLabel
          ),
      };
    }),
  ];
}

function OrganizationBreadcrumbLabel({ fallback, slug }: { fallback: string; slug: string }) {
  const { data: organization } = useCurrentOrganization({ slug });

  return organization?.name ?? fallback;
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
  return (
    <SidebarProvider defaultOpen>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex w-full items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <AppBreadcrumbs />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden p-4 pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
