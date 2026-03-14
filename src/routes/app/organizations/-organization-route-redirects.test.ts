import { describe, expect, it } from 'vitest';
import { Route as OrganizationIndexRoute } from './$slug/index';
import { Route as OrganizationMembersRoute } from './$slug/members';

const search = {
  page: 2,
  pageSize: 25,
  sortBy: 'email' as const,
  sortOrder: 'asc' as const,
  secondarySortBy: 'createdAt' as const,
  secondarySortOrder: 'desc' as const,
  search: 'alice',
  kind: 'member' as const,
};

function getRedirect(thunk: () => unknown) {
  try {
    thunk();
  } catch (error) {
    return error;
  }

  throw new Error('Expected route to redirect');
}

describe('organization route redirects', () => {
  it('redirects the organization index route to settings', () => {
    const redirect = getRedirect(() =>
      OrganizationIndexRoute.options.beforeLoad?.({
        params: { slug: 'acme' },
      } as never),
    );

    expect((redirect as { options: unknown }).options).toMatchObject({
      to: '/app/organizations/$slug/settings',
      params: { slug: 'acme' },
      replace: true,
    });
  });

  it('redirects the organization members route to settings with search params', () => {
    const redirect = getRedirect(() =>
      OrganizationMembersRoute.options.beforeLoad?.({
        params: { slug: 'acme' },
        search,
      } as never),
    );

    expect((redirect as { options: unknown }).options).toMatchObject({
      to: '/app/organizations/$slug/settings',
      params: { slug: 'acme' },
      search,
      replace: true,
    });
  });
});
