import { describe, expect, it } from 'vitest';
import { collectOrganizationAuditPage } from './organizationManagement';

function createQueryResult(rows: unknown[]) {
  return {
    order: () => ({
      paginate: async () => ({
        continueCursor: 'cursor-1',
        isDone: true,
        page: rows,
      }),
    }),
  };
}

describe('collectOrganizationAuditPage', () => {
  it('uses audit ledger rows for organization views', async () => {
    const ctx = {
      db: {
        query: (table: string) => {
          if (table === 'auditLedgerEvents') {
            return {
              withIndex: () =>
                createQueryResult([
                  {
                    chainId: 'primary',
                    id: 'audit-1',
                    sequence: 1,
                    eventType: 'member_added',
                    userId: 'user-1',
                    actorUserId: 'user-1',
                    targetUserId: 'user-2',
                    organizationId: 'org-1',
                    identifier: 'user@example.com',
                    outcome: 'success',
                    severity: 'info',
                    resourceType: 'organization_member',
                    resourceId: 'membership-1',
                    resourceLabel: 'Membership',
                    sourceSurface: 'organization.members',
                    eventHash: 'hash-1',
                    previousEventHash: null,
                    metadata: null,
                    recordedAt: 100,
                    ipAddress: undefined,
                    userAgent: undefined,
                  },
                ]),
            };
          }

          throw new Error(`Unexpected query table: ${table}`);
        },
      },
    };

    const result = await collectOrganizationAuditPage(ctx as never, {
      organizationId: 'org-1',
      requestedEventType: null,
      searchStrategy: { kind: 'organization' },
      sortOrder: 'desc',
      cursor: null,
      numItems: 25,
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      auditEventId: 'audit-1',
      organizationId: 'org-1',
    });
  });

  it('projects raw ledger events into organization audit rows', async () => {
    const ctx = {
      db: {
        query: (table: string) => {
          if (table === 'auditLedgerEvents') {
            return {
              withIndex: () =>
                createQueryResult([
                  {
                    chainId: 'primary',
                    id: 'audit-2',
                    sequence: 2,
                    eventType: 'domain_added',
                    userId: 'user-1',
                    actorUserId: 'user-1',
                    targetUserId: undefined,
                    organizationId: 'org-1',
                    identifier: 'admin@example.com',
                    sessionId: undefined,
                    requestId: undefined,
                    outcome: 'success',
                    severity: 'info',
                    resourceType: 'organization_domain',
                    resourceId: 'domain-1',
                    resourceLabel: 'example.com',
                    sourceSurface: 'organization.domain_add',
                    eventHash: 'hash-2',
                    previousEventHash: null,
                    metadata: JSON.stringify({ domain: 'example.com' }),
                    recordedAt: 200,
                    ipAddress: undefined,
                    userAgent: undefined,
                  },
                ]),
            };
          }

          throw new Error(`Unexpected query table: ${table}`);
        },
      },
    };

    const result = await collectOrganizationAuditPage(ctx as never, {
      organizationId: 'org-1',
      requestedEventType: null,
      searchStrategy: { kind: 'organization' },
      sortOrder: 'desc',
      cursor: null,
      numItems: 25,
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      auditEventId: 'audit-2',
      eventType: 'domain_added',
      organizationId: 'org-1',
      label: 'Domain added',
    });
  });
});
