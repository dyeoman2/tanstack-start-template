import { useLocation } from '@tanstack/react-router';
import { Bot, Building2, LayoutDashboard, Shield } from 'lucide-react';
import * as React from 'react';
import { NavMain, type NavMainItem } from '~/components/sidebar/NavMain';
import { NavUser } from '~/components/sidebar/NavUser';
import { TeamSwitcher, type TeamSwitcherItem } from '~/components/sidebar/TeamSwitcher';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '~/components/ui/sidebar';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { cn } from '~/lib/utils';

function TanStackLogo({ className }: { className?: string }) {
  return (
    <img
      src="/android-chrome-192x192.png"
      alt="TanStack Start"
      className={cn('rounded-md object-cover', className)}
    />
  );
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();
  const authState = useAuthState();
  const { user, isAdmin } = useAuth({ fetchRole: authState.isAuthenticated });

  const teams = React.useMemo<TeamSwitcherItem[]>(() => {
    const items: TeamSwitcherItem[] = [
      {
        name: 'TanStack Start',
        logo: TanStackLogo,
        plan: 'Application workspace',
        to: '/app',
      },
      {
        name: 'Organizations',
        logo: Building2,
        plan: 'Shared workspaces',
        to: '/app/organizations',
      },
    ];

    if (isAdmin) {
      items.push({
        name: 'Admin',
        logo: Shield,
        plan: 'Site administration',
        to: '/app/admin',
      });
    }

    return items;
  }, [isAdmin]);

  const navMain = React.useMemo<NavMainItem[]>(() => {
    const items: NavMainItem[] = [
      {
        title: 'Dashboard',
        to: '/app',
        icon: LayoutDashboard,
        isActive:
          location.pathname === '/app' ||
          location.pathname === '/app/profile',
      },
      {
        title: 'Playground',
        to: '/app/ai-playground',
        icon: Bot,
        isActive: location.pathname === '/app/ai-playground',
      },
    ];

    return items;
  }, [location.pathname]);

  const initials =
    user?.name
      ?.split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') ??
    user?.email.charAt(0).toUpperCase() ??
    'TS';

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          showAdmin={isAdmin}
          user={{
            name: user?.name || 'Authenticated user',
            email: user?.email || 'Signed in',
            initials,
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
