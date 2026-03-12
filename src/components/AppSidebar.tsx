import { useLocation } from '@tanstack/react-router';
import { LayoutDashboard, MessageSquare } from 'lucide-react';
import * as React from 'react';
import { NavMain, type NavMainItem } from '~/components/sidebar/NavMain';
import { NavUser } from '~/components/sidebar/NavUser';
import { TeamSwitcher } from '~/components/sidebar/TeamSwitcher';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '~/components/ui/sidebar';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { ChatSidebarGroup } from '~/features/chat/components/ChatSidebarGroup';

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation();
  const authState = useAuthState();
  const { user, isSiteAdmin } = useAuth({ fetchRole: authState.isAuthenticated });

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
        title: 'Chat',
        to: '/app/chat',
        icon: MessageSquare,
        isActive:
          location.pathname === '/app/chat' || location.pathname.startsWith('/app/chat/'),
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
        <TeamSwitcher teams={[]} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <ChatSidebarGroup />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          showAdmin={isSiteAdmin}
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
