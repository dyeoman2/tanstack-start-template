import { useEffect, useState } from 'react';

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

export function useStableOrganizationName({
  fallback = 'Loading organization',
  names,
  slug,
  state,
}: {
  fallback?: string;
  names: Array<string | null | undefined>;
  slug: string;
  state: unknown;
}) {
  const breadcrumbName = getOrganizationBreadcrumbName(state, slug);
  const latestKnownName = [...names, breadcrumbName].find(isNonEmptyOrganizationName);
  const [stableName, setStableName] = useState<string | undefined>(latestKnownName);

  useEffect(() => {
    if (!latestKnownName) {
      return;
    }

    setStableName((currentName) => (currentName === latestKnownName ? currentName : latestKnownName));
  }, [latestKnownName]);

  return latestKnownName ?? stableName ?? fallback;
}

function isNonEmptyOrganizationName(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
