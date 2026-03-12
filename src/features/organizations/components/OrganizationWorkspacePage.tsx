import {
  OrganizationInvitationsCard,
  OrganizationMembersCard,
  useCurrentOrganization,
} from '@daveyplate/better-auth-ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { OrganizationSettingsCards } from '~/features/organizations/components/OrganizationSettingsCards';
import { cn } from '~/lib/utils';

type OrganizationWorkspaceView = 'MEMBERS' | 'SETTINGS';

interface OrganizationWorkspacePageProps {
  slug: string;
  view: OrganizationWorkspaceView;
}

export function OrganizationWorkspacePage({ slug, view }: OrganizationWorkspacePageProps) {
  const navigate = useNavigate();
  const { data: organization, isPending } = useCurrentOrganization({ slug });

  useEffect(() => {
    if (isPending || organization) {
      return;
    }

    void navigate({ to: '/app/organizations', replace: true });
  }, [isPending, navigate, organization]);

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-2">
        <p className="text-sm text-muted-foreground">Organizations</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Loading organization
        </h1>
        <p className="text-base text-muted-foreground">Preparing the organization settings.</p>
      </div>
    );
  }

  if (!organization) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization not found</CardTitle>
          <CardDescription>
            The requested organization is unavailable or you no longer have access to it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/app/organizations">Back to organizations</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={organization.name}
        description="Edit details, manage members, and control organization access from one place."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/app/organizations">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
        }
      />

      <nav className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-muted/30 p-1">
        <NavLink isActive={view === 'SETTINGS'} slug={slug} view="SETTINGS" />
        <NavLink isActive={view === 'MEMBERS'} slug={slug} view="MEMBERS" />
      </nav>

      <div className="space-y-5">
        {view === 'SETTINGS' ? (
          <OrganizationSettingsCards
            slug={slug}
            classNames={{
              cards: 'w-full gap-5',
              card: organizationCardClassNames,
            }}
          />
        ) : (
          <>
            <OrganizationMembersCard slug={slug} classNames={organizationCardClassNames} />
            <OrganizationInvitationsCard
              slug={slug}
              classNames={organizationCardClassNames}
              emptyState={
                <Card>
                  <CardHeader>
                    <CardTitle>Pending invitations</CardTitle>
                    <CardDescription className="text-sm leading-6 text-muted-foreground">
                      No invitations are waiting for a response right now.
                    </CardDescription>
                  </CardHeader>
                </Card>
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function NavLink({
  isActive,
  slug,
  view,
}: {
  isActive: boolean;
  slug: string;
  view: OrganizationWorkspaceView;
}) {
  const href =
    view === 'SETTINGS' ? '/app/organizations/$slug/settings' : '/app/organizations/$slug/members';

  return (
    <Button
      asChild
      variant={isActive ? 'secondary' : 'ghost'}
      className={cn(
        'h-8 rounded-sm px-3 text-sm',
        isActive && 'bg-background shadow-sm hover:bg-background',
      )}
    >
      <Link to={href} params={{ slug }}>
        {view === 'SETTINGS' ? 'Settings' : 'Members'}
      </Link>
    </Button>
  );
}

const organizationCardClassNames = {
  base: 'overflow-hidden rounded-xl border border-border shadow-sm',
  header: 'px-6 pt-6 pb-4',
  title: 'text-base font-semibold',
  description: 'mt-2 text-sm leading-6 text-muted-foreground',
  content: 'px-6 pb-6',
  footer: 'border-t border-border bg-muted/20 px-6 pt-6',
  instructions: 'text-sm leading-6 text-muted-foreground',
  input: 'h-10 rounded-xl border-border/80 bg-background shadow-none',
  label: 'text-sm font-medium',
  primaryButton: 'h-9 px-4',
  secondaryButton: 'h-9 px-4',
  outlineButton: 'h-9 px-4',
  destructiveButton: 'h-9 px-4',
  button: 'h-9',
  cell: 'rounded-md border border-border bg-background px-4 py-3',
};
