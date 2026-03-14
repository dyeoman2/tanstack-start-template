import { describe, expect, it, vi } from 'vitest';
import { fetchBetterAuthInvitationsByOrganizationAndEmail } from './betterAuth';

vi.mock('../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth.adapter.findMany',
      },
    },
  },
}));

describe('fetchBetterAuthInvitationsByOrganizationAndEmail', () => {
  it('queries invitations with organization and normalized email filters', async () => {
    const runQueryMock = vi.fn().mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: null,
    });

    await fetchBetterAuthInvitationsByOrganizationAndEmail(
      {
        runQuery: runQueryMock,
      } as never,
      'org_1',
      'Person@Example.com',
    );

    expect(runQueryMock).toHaveBeenCalledWith('betterAuth.adapter.findMany', {
      model: 'invitation',
      where: [
        {
          field: 'organizationId',
          operator: 'eq',
          value: 'org_1',
        },
        {
          field: 'email',
          operator: 'eq',
          value: 'person@example.com',
          connector: 'AND',
        },
      ],
      paginationOpts: {
        cursor: null,
        numItems: 1000,
        id: 0,
      },
    });
  });
});
