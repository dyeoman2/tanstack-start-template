import { api } from '@convex/_generated/api';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import type { Organization } from 'better-auth/plugins/organization';
import { useQuery } from 'convex/react';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { refreshOrganizationClientState } from '~/features/organizations/lib/organization-session';

type OrganizationSwitcherItem = {
  id?: string;
  name: string;
  logo: React.ElementType;
  description: string;
  to: string;
};

export function OrganizationSwitcher() {
  const { isMobile } = useSidebar();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const { showToast } = useToast();
  const { data: organizations, isPending: organizationsPending } = authHooks.useListOrganizations();
  const { data: activeOrganization } = authHooks.useActiveOrganization();
  const eligibility = useQuery(api.organizationManagement.getOrganizationCreationEligibility, {});
  const [activeOrganizationItem, setActiveOrganizationItem] = React.useState<OrganizationSwitcherItem>({
    name: 'Select organization',
    logo: Building2,
    description: 'Choose a workspace',
    to: '/app/organizations',
  });
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const canCreateOrganization = eligibility?.canCreate ?? false;
  const creationReason = eligibility?.reason ?? null;

  const organizationItems = React.useMemo<OrganizationSwitcherItem[]>(() => {
    return (organizations ?? []).map((organization) => ({
      id: organization.id,
      name: organization.name,
      logo: Building2,
      description: 'Organization workspace',
      to: `/app/organizations/${organization.slug}/settings`,
    }));
  }, [organizations]);

  React.useEffect(() => {
    const matchedOrganizationItem = activeOrganization
      ? (organizationItems.find((organization) => organization.id === activeOrganization.id) ?? {
          id: activeOrganization.id,
          name: activeOrganization.name,
          logo: Building2,
          description: 'Organization workspace',
          to: `/app/organizations/${activeOrganization.slug}/settings`,
        })
      : {
          name: organizations && organizations.length > 0 ? 'Select organization' : 'No organization',
          logo: Building2,
          description:
            organizations && organizations.length > 0
              ? 'Choose a workspace'
              : 'Create your first organization',
          to: '/app/organizations',
        };

    setActiveOrganizationItem(matchedOrganizationItem);
  }, [activeOrganization, location.pathname, organizationItems, organizations]);

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
                <activeOrganizationItem.logo className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{activeOrganizationItem.name}</span>
                <span className="truncate text-xs">{activeOrganizationItem.description}</span>
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
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
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
                      onActiveOrganizationChange: setActiveOrganizationItem,
                      onError: showToast,
                      queryClient,
                      routerInvalidate: async () => {
                        await router.invalidate();
                      },
                    });
                  }}
                >
                  <div className="flex size-6 items-center justify-center rounded-sm border bg-muted/30 text-[11px] font-semibold">
                    {getInitials(organization.name)}
                  </div>
                  <span className="truncate">{organization.name}</span>
                  {activeOrganization?.id === organization.id ? (
                    <Check className="ml-auto size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No organizations yet</div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2"
              disabled={!canCreateOrganization}
              onSelect={(event) => {
                if (!canCreateOrganization) {
                  event.preventDefault();
                  return;
                }

                event.preventDefault();
                setCreateDialogOpen(true);
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">
                {canCreateOrganization
                  ? 'Add organization'
                  : (creationReason ?? 'Add organization')}
              </div>
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
  onActiveOrganizationChange,
  onError,
  queryClient,
  routerInvalidate,
}: {
  organization: Organization;
  navigate: ReturnType<typeof useNavigate>;
  onActiveOrganizationChange: (organization: OrganizationSwitcherItem) => void;
  onError: (message: string, variant: 'error' | 'success' | 'info') => void;
  queryClient: Pick<QueryClient, 'invalidateQueries'>;
  routerInvalidate: () => Promise<void>;
}) {
  try {
    await authClient.organization.setActive({
      organizationId: organization.id,
      fetchOptions: { throw: true },
    });
    await refreshOrganizationClientState(queryClient, {
      invalidateRouter: routerInvalidate,
    });

    const nextOrganization = {
      id: organization.id,
      name: organization.name,
      logo: Building2,
      description: 'Organization workspace',
      to: `/app/organizations/${organization.slug}/settings`,
    } satisfies OrganizationSwitcherItem;

    onActiveOrganizationChange(nextOrganization);
    await navigate({
      to: '/app/organizations/$slug/settings',
      params: { slug: organization.slug },
      state: {
        organizationBreadcrumb: {
          name: organization.name,
          slug: organization.slug,
        },
      },
    });
  } catch (error) {
    onError(getErrorMessage(error), 'error');
  }
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
