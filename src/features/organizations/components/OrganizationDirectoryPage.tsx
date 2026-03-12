import { UserInvitationsCard } from '@daveyplate/better-auth-ui';
import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Link } from '@tanstack/react-router';
import { Building2, Plus, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { useAuthState } from '~/features/auth/hooks/useAuthState';
import { CreateOrganizationDialog } from '~/features/organizations/components/CreateOrganizationDialog';

export function OrganizationDirectoryPage() {
  const authState = useAuthState();
  const organizations = useQuery(api.organizationManagement.listOrganizationsForDirectory, {});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const isPending = organizations === undefined;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title="Organizations"
          description={
            !isPending && organizations
              ? `Manage organization settings, members, and invitations.`
              : 'Open an organization to manage settings, members, and invitations.'
          }
          actions={
            <Button onClick={() => setCreateDialogOpen(true)} size="sm">
              <Plus className="size-4" />
              Create organization
            </Button>
          }
        />

        <div className="space-y-4">
          {authState.isPending || isPending ? (
            <>
              <OrganizationRowSkeleton />
              <OrganizationRowSkeleton />
            </>
          ) : organizations && organizations.length > 0 ? (
            organizations.map((organization) => (
              <OrganizationRow key={organization.id} organization={organization} />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Building2 className="size-6" />
              </div>
              <h2 className="text-lg font-semibold">No organizations yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Create your first organization to collaborate with teammates and manage access from
                a shared home.
              </p>
              <Button onClick={() => setCreateDialogOpen(true)} className="mt-5" size="sm">
                <Plus className="size-4" />
                Create organization
              </Button>
            </div>
          )}
        </div>

        <UserInvitationsCard
          classNames={{
            base: 'overflow-hidden rounded-xl border border-border shadow-sm py-6',
            header: 'px-6 pb-4',
            title: 'text-base font-semibold',
            description: 'text-sm leading-6 text-muted-foreground',
            content: 'px-6',
            cell: 'rounded-lg border border-border bg-background px-4 py-3',
            button: '',
            outlineButton: '',
          }}
        />
      </div>

      <CreateOrganizationDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </>
  );
}

function OrganizationRow({
  organization,
}: {
  organization: {
    id: string;
    slug: string;
    name: string;
    logo: string | null;
    viewerRole: 'site-admin' | 'owner' | 'admin' | 'member';
    canManage: boolean;
    isSiteAdminView: boolean;
  };
}) {
  const slug = organization.slug;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/30 sm:flex-row sm:items-center sm:justify-between">
      <Link
        to="/app/organizations/$slug/settings"
        params={{ slug }}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-md outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="text-sm font-semibold">{getInitials(organization.name)}</span>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{organization.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.isSiteAdminView
              ? 'Site admin access'
              : organization.viewerRole === 'owner'
                ? 'Owner'
                : organization.viewerRole === 'admin'
                  ? 'Admin'
                  : 'Member'}
          </p>
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/app/organizations/$slug/members" params={{ slug }}>
            <Users className="size-4" />
            Members
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/app/organizations/$slug/settings" params={{ slug }}>
            <Settings className="size-4" />
            Settings
          </Link>
        </Button>
      </div>
    </div>
  );
}

function OrganizationRowSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
