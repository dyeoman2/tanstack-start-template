export function getOrganizationBreadcrumbName(state: unknown, slug: string) {
  if (!isOrganizationBreadcrumbState(state)) {
    return undefined;
  }

  const breadcrumb = state.organizationBreadcrumb;

  if (!breadcrumb || breadcrumb.slug !== slug) {
    return undefined;
  }

  return breadcrumb.name;
}

function isOrganizationBreadcrumbState(state: unknown): state is {
  organizationBreadcrumb?: {
    name: string;
    slug: string;
  };
} {
  if (!state || typeof state !== 'object') {
    return false;
  }

  if (!('organizationBreadcrumb' in state)) {
    return false;
  }

  const { organizationBreadcrumb } = state;

  if (!organizationBreadcrumb || typeof organizationBreadcrumb !== 'object') {
    return false;
  }

  return (
    'name' in organizationBreadcrumb &&
    typeof organizationBreadcrumb.name === 'string' &&
    'slug' in organizationBreadcrumb &&
    typeof organizationBreadcrumb.slug === 'string'
  );
}
