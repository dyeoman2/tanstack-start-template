import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/server/vendor-boundary.server', () => ({
  getVendorBoundarySnapshot: () => [
    {
      allowedDataClasses: ['error telemetry'],
      allowedEnvironments: ['production'] as const,
      approvalEnvVar: null,
      approved: true,
      approvedByDefault: true,
      displayName: 'Sentry',
      vendor: 'sentry' as const,
    },
  ],
}));

import { getSecurityRelationshipObjectTypeFromSourceRecordType } from './core';
import { buildVendorWorkspaceRows } from './vendors_core';

describe('vendor relationship compatibility', () => {
  it('maps legacy vendor review source records to vendor relationships', () => {
    expect(getSecurityRelationshipObjectTypeFromSourceRecordType('vendor_review')).toBe('vendor');
  });

  it('surfaces legacy vendor_review links in vendor workspaces', async () => {
    const reviewRun = {
      _id: 'run-1',
      createdAt: 100,
      status: 'ready' as const,
      title: 'Vendor follow-up',
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === reviewRun._id ? reviewRun : null)),
        query: (table: string) => {
          if (table === 'securityVendors' || table === 'securityVendorControlMappings') {
            return {
              collect: async () => [],
            };
          }

          if (table === 'securityRelationships') {
            return {
              collect: async () => [
                {
                  _id: 'relationship-1',
                  _creationTime: 100,
                  createdAt: 100,
                  createdByUserId: 'admin-user',
                  fromId: 'sentry',
                  fromType: 'vendor_review' as const,
                  relationshipType: 'follow_up_for' as const,
                  scopeId: 'security',
                  scopeType: 'provider_global' as const,
                  toId: reviewRun._id,
                  toType: 'review_run' as const,
                },
              ],
            };
          }

          if (table === 'reviewRuns') {
            return {
              withIndex: () => ({
                unique: async () => null,
              }),
            };
          }

          if (table === 'reviewTasks') {
            return {
              withIndex: () => ({
                collect: async () => [],
              }),
            };
          }

          if (table === 'userProfiles') {
            return {
              withIndex: () => ({
                collect: async () => [
                  {
                    _id: 'profile-1',
                    createdAt: 1,
                    email: 'admin@example.com',
                    isSiteAdmin: true,
                    name: 'Admin User',
                    role: 'admin',
                  },
                ],
              }),
            };
          }

          throw new Error(`Unexpected query table: ${table}`);
        },
      },
    };

    const rows = await buildVendorWorkspaceRows(ctx as never);

    expect(rows).toEqual([
      expect.objectContaining({
        linkedEntities: [
          expect.objectContaining({
            entityId: 'run-1',
            entityType: 'review_run',
            label: 'Vendor follow-up',
            relationshipType: 'follow_up_for',
            status: 'ready',
          }),
        ],
        vendor: 'sentry',
      }),
    ]);
  });
});
