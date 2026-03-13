import * as React from 'react';
import type { Organization } from 'better-auth/plugins/organization';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '~/components/ui/sidebar';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { authClient, authHooks } from '~/features/auth/auth-client';
import { CreateOrganizationDialog } from '~/features/organizations/components/CreateOrganizationDialog';

export type TeamSwitcherItem = {
  name: string;
  logo: React.ElementType;
  plan: string;
  to: string;
};

export function TeamSwitcher({ teams }: { teams: TeamSwitcherItem[] }) {
  const { isMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { data: organizations, isPending: organizationsPending } = authHooks.useListOrganizations();
  const { data: activeOrganization } = authHooks.useActiveOrganization();
  const [activeTeam, setActiveTeam] = React.useState<TeamSwitcherItem | null>(teams[0] ?? null);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  const organizationItems = React.useMemo<TeamSwitcherItem[]>(() => {
    return (organizations ?? []).map((organization) => ({
      name: organization.name,
      logo: Building2,
      plan: 'Organization workspace',
      to: `/app/organizations/${organization.slug}/settings`,
    }));
  }, [organizations]);

  React.useEffect(() => {
    const organizationSlug = getOrganizationSlugFromPath(location.pathname);
    const matchedOrganization =
      (organizationSlug
        ? organizationItems.find((team) => team.to.startsWith(`/app/organizations/${organizationSlug}/`))
        : null) ??
      (location.pathname.startsWith('/app/organizations') && activeOrganization
        ? organizationItems.find((team) => team.name === activeOrganization.name) ?? null
        : null);

    const matchedTeam =
      matchedOrganization ??
      teams.find((team) => location.pathname === team.to || location.pathname.startsWith(`${team.to}/`)) ??
      teams[0] ??
      organizationItems[0] ??
      null;

    setActiveTeam(matchedTeam);
  }, [activeOrganization, location.pathname, organizationItems, teams]);

  if (!activeTeam) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <activeTeam.logo className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{activeTeam.name}</span>
                <span className="truncate text-xs">{activeTeam.plan}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            {teams.map((team, index) => (
              <DropdownMenuItem
                key={team.name}
                className="gap-2 p-2"
                onClick={() => {
                  setActiveTeam(team);
                  void navigate({
                    to: team.to,
                  });
                }}
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <team.logo className="size-4 shrink-0" />
                </div>
                {team.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
            {organizationsPending ? (
              <div className="space-y-2 px-2 py-1">
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ) : organizations && organizations.length > 0 ? (
              organizations.map((organization) => (
                <DropdownMenuItem
                  key={organization.id}
                  className="gap-2 p-2"
                  onClick={() => {
                    void handleOrganizationSelect({
                      organization,
                      navigate,
                      onActiveTeamChange: setActiveTeam,
                      onError: showToast,
                    });
                  }}
                >
                  <div className="flex size-6 items-center justify-center rounded-sm border bg-muted/30 text-[11px] font-semibold">
                    {getInitials(organization.name)}
                  </div>
                  <span className="truncate">{organization.name}</span>
                  {activeOrganization?.id === organization.id ? <Check className="ml-auto size-4" /> : null}
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No organizations yet</div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              onSelect={(event) => {
                event.preventDefault();
                setCreateDialogOpen(true);
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">Add organization</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <CreateOrganizationDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </SidebarMenu>
  );
}

async function handleOrganizationSelect({
  organization,
  navigate,
  onActiveTeamChange,
  onError,
}: {
  organization: Organization;
  navigate: ReturnType<typeof useNavigate>;
  onActiveTeamChange: (team: TeamSwitcherItem) => void;
  onError: (message: string, variant: 'error' | 'success' | 'info') => void;
}) {
  try {
    await authClient.organization.setActive({
      organizationId: organization.id,
      fetchOptions: { throw: true },
    });

    const team = {
      name: organization.name,
      logo: Building2,
      plan: 'Organization workspace',
      to: `/app/organizations/${organization.slug}/settings`,
    } satisfies TeamSwitcherItem;

    onActiveTeamChange(team);
    await navigate({
      to: '/app/organizations/$slug/settings',
      params: { slug: organization.slug },
    });
  } catch (error) {
    onError(getErrorMessage(error), 'error');
  }
}

function getOrganizationSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/app\/organizations\/([^/]+)/);
  return match?.[1] ?? null;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Failed to switch organization';
}
