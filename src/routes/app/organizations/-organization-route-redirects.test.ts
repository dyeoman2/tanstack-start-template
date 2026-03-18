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
  it('redirects the organization index route to members', () => {
    const redirect = getRedirect(() =>
      OrganizationIndexRoute.options.beforeLoad?.({
        params: { slug: 'acme' },
      } as never),
    );

    expect((redirect as { options: unknown }).options).toMatchObject({
      to: '/app/organizations/$slug/members',
      params: { slug: 'acme' },
      replace: true,
    });
  });

  it('does not redirect the organization members route', () => {
    expect(
      OrganizationMembersRoute.options.beforeLoad?.({
        params: { slug: 'acme' },
        search,
      } as never),
    ).toBeUndefined();
  });
});
