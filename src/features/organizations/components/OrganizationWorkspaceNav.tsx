import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

type OrganizationWorkspaceView = 'MEMBERS' | 'SETTINGS';

interface OrganizationWorkspaceNavProps {
  description: string;
  slug: string;
  title: string;
  view: OrganizationWorkspaceView;
  actions?: ReactNode;
}

export function OrganizationWorkspaceNav({
  description,
  slug,
  title,
  view,
  actions,
}: OrganizationWorkspaceNavProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2">
            {actions}
            <Button asChild variant="outline" size="sm">
              <Link to="/app/organizations">
                <ArrowLeft className="size-4" />
                Back
              </Link>
            </Button>
          </div>
        }
      />

      <nav className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-muted/30 p-1">
        <NavLink isActive={view === 'SETTINGS'} slug={slug} view="SETTINGS" />
        <NavLink isActive={view === 'MEMBERS'} slug={slug} view="MEMBERS" />
      </nav>
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
