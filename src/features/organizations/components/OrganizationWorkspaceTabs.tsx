import { Link, useLocation } from '@tanstack/react-router';
import { getOrganizationBreadcrumbName } from '~/features/organizations/lib/organization-breadcrumb-state';
import { cn } from '~/lib/utils';

export function OrganizationWorkspaceTabs({
  slug,
  organizationName,
}: {
  slug: string;
  organizationName?: string;
}) {
  const location = useLocation();
  const currentPath = location.pathname;
  const breadcrumbName = organizationName ?? getOrganizationBreadcrumbName(location.state, slug);
  const tabs = [
    { label: 'General', to: '/app/organizations/$slug/settings' as const },
    { label: 'Members', to: '/app/organizations/$slug/members' as const },
    { label: 'SSO & Provisioning', to: '/app/organizations/$slug/identity' as const },
    { label: 'Access policies', to: '/app/organizations/$slug/policies' as const },
    { label: 'Audit', to: '/app/organizations/$slug/audit' as const },
  ];

  return (
    <div className="mb-6">
      <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-[3px]">
        {tabs.map((tab) => {
          const href = tab.to.replace('$slug', slug);
          const isActive = currentPath === href;

          return (
            <Link
              key={tab.label}
              to={tab.to}
              params={{ slug }}
              state={(previousState) => ({
                ...(isRecord(previousState) ? previousState : {}),
                ...(breadcrumbName
                  ? {
                      organizationBreadcrumb: {
                        slug,
                        name: breadcrumbName,
                      },
                    }
                  : {}),
              })}
              className={cn(
                'inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition-[color,box-shadow]',
                isActive
                  ? 'border border-input bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
