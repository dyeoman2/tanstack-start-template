import { describe, expect, it } from 'vitest';
import { validateRegulatedAuditFields } from './audit';

function buildUserRecord(eventType: string, metadata: unknown) {
  return {
    actorUserId: 'user-1',
    eventType,
    provenance: {
      actorUserId: 'user-1',
      emitter: 'test',
      kind: 'user' as const,
    },
    metadata: JSON.stringify(metadata),
    organizationId: 'org-1',
    outcome: 'success' as const,
    resourceId: 'resource-1',
    resourceType: 'test_resource',
    severity: 'info' as const,
    sourceSurface: 'test.surface',
  };
}

function buildSystemRecord(
  eventType: string,
  metadata: unknown,
  overrides?: {
    outcome?: 'failure' | 'success';
    severity?: 'critical' | 'info' | 'warning';
  },
) {
  return {
    eventType,
    provenance: {
      emitter: 'test',
      kind: 'system' as const,
    },
    metadata: JSON.stringify(metadata),
    organizationId: 'org-1',
    outcome: overrides?.outcome ?? ('success' as const),
    resourceId: 'resource-1',
    resourceType: 'test_resource',
    severity: overrides?.severity ?? ('info' as const),
    sourceSurface: 'test.surface',
  };
}

describe('regulated audit validation', () => {
  it('accepts privileged events with complete manifest-linked metadata', () => {
    expect(() =>
      validateRegulatedAuditFields({
        actorUserId: 'admin-user',
        eventType: 'audit_log_exported',
        provenance: {
          actorUserId: 'admin-user',
          emitter: 'test',
          kind: 'site_admin',
        },
        metadata: JSON.stringify({
          exportHash: 'payload-hash',
          exportId: 'export-1',
          filters: { preset: 'all' },
          manifestHash: 'manifest-hash',
          rowCount: 10,
          scope: 'org-1',
        }),
        organizationId: 'org-1',
        outcome: 'success',
        resourceId: 'org-1-audit',
        resourceType: 'audit_export',
        severity: 'info',
        sourceSurface: 'organization.audit_export',
      }),
    ).not.toThrow();
  });

  it('fails closed when export metadata is incomplete', () => {
    expect(() =>
      validateRegulatedAuditFields({
        actorUserId: 'admin-user',
        eventType: 'audit_log_exported',
        provenance: {
          actorUserId: 'admin-user',
          emitter: 'test',
          kind: 'site_admin',
        },
        metadata: JSON.stringify({
          exportHash: 'payload-hash',
          rowCount: 10,
        }),
        organizationId: 'org-1',
        outcome: 'success',
        resourceId: 'org-1-audit',
        resourceType: 'audit_export',
        severity: 'info',
        sourceSurface: 'organization.audit_export',
      }),
    ).toThrow(/exportId|manifestHash/);
  });

  it('fails denied events that omit permission or reason metadata', () => {
    expect(() =>
      validateRegulatedAuditFields({
        actorUserId: 'user-1',
        eventType: 'authorization_denied',
        provenance: {
          actorUserId: 'user-1',
          emitter: 'test',
          kind: 'user',
        },
        metadata: JSON.stringify({
          permission: 'viewAudit',
        }),
        outcome: 'failure',
        resourceId: 'org-1',
        resourceType: 'organization_permission',
        severity: 'warning',
        sourceSurface: 'auth.authorization',
      }),
    ).toThrow(/reason/);
  });

  it.each([
    [
      'chat_attachment_uploaded',
      buildUserRecord('chat_attachment_uploaded', {
        attachmentId: 'attachment-1',
        kind: 'document',
        mimeType: 'application/pdf',
        sizeBytes: 128,
      }),
    ],
    [
      'chat_run_completed',
      buildSystemRecord('chat_run_completed', {
        model: 'openai/gpt-5.4',
        provider: 'openrouter',
        runId: 'run-1',
        useWebSearch: true,
      }),
    ],
    [
      'chat_web_search_used',
      buildSystemRecord('chat_web_search_used', {
        fetchedDomains: ['example.com'],
        model: 'openai/gpt-5.4',
        runId: 'run-1',
        sourceCount: 1,
      }),
    ],
    [
      'outbound_vendor_access_used',
      buildSystemRecord('outbound_vendor_access_used', {
        runId: 'run-1',
        useWebSearch: false,
        vendor: 'openrouter',
      }),
    ],
    [
      'retention_purge_completed',
      buildSystemRecord('retention_purge_completed', {
        batchId: 'batch-1',
        deletedCount: 4,
        failedCount: 0,
      }),
    ],
    [
      'file_access_ticket_issued',
      buildUserRecord('file_access_ticket_issued', {
        expiresInMinutes: 15,
        issuedIpAddress: '203.0.113.10',
        issuedUserAgent: 'vitest',
        purpose: 'interactive_open',
        ticketId: 'ticket-1',
      }),
    ],
    [
      'file_access_redeemed',
      buildUserRecord('file_access_redeemed', {
        ipAddress: null,
        purpose: 'external_share',
        sourceSurface: 'file.serve_redeem',
        ticketId: 'ticket-1',
        userAgent: 'browser',
      }),
    ],
    [
      'file_access_redeem_failed',
      buildSystemRecord(
        'file_access_redeem_failed',
        {
          attemptedSessionId: null,
          attemptedUserId: null,
          error: 'Invalid file access ticket signature.',
          expiresAt: null,
          ipAddress: '203.0.113.10',
          sourceSurface: null,
          ticketId: 'ticket-1',
          userAgent: null,
        },
        {
          outcome: 'failure',
          severity: 'warning',
        },
      ),
    ],
  ])('accepts emitted metadata shape for %s', (_eventType, record) => {
    expect(() => validateRegulatedAuditFields(record)).not.toThrow();
  });

  it.each([
    [
      'chat_attachment_uploaded',
      buildUserRecord('chat_attachment_uploaded', {
        attachmentId: 'attachment-1',
        kind: 'document',
        mimeType: 'application/pdf',
      }),
      /sizeBytes/,
    ],
    [
      'chat_run_completed',
      buildSystemRecord('chat_run_completed', {
        model: 'openai/gpt-5.4',
        provider: 'openrouter',
        runId: 'run-1',
        useWebSearch: 'yes',
      }),
      /useWebSearch/,
    ],
    [
      'chat_web_search_used',
      buildSystemRecord('chat_web_search_used', 'not-an-object'),
      /structured metadata/,
    ],
    [
      'outbound_vendor_access_used',
      buildSystemRecord('outbound_vendor_access_used', {
        runId: 'run-1',
        vendor: 'openrouter',
      }),
      /useWebSearch/,
    ],
    [
      'retention_purge_completed',
      buildSystemRecord('retention_purge_completed', {
        batchId: 'batch-1',
        deletedCount: '4',
        failedCount: 0,
      }),
      /deletedCount/,
    ],
    [
      'file_access_ticket_issued',
      buildUserRecord('file_access_ticket_issued', {
        expiresInMinutes: 15,
        issuedIpAddress: '203.0.113.10',
        purpose: 'interactive_open',
        ticketId: 'ticket-1',
      }),
      /issuedUserAgent/,
    ],
    [
      'file_access_redeemed',
      buildUserRecord('file_access_redeemed', {
        ipAddress: null,
        purpose: 'external_share',
        sourceSurface: 12,
        ticketId: 'ticket-1',
        userAgent: 'browser',
      }),
      /sourceSurface/,
    ],
    [
      'file_access_redeem_failed',
      buildSystemRecord(
        'file_access_redeem_failed',
        {
          attemptedSessionId: null,
          attemptedUserId: null,
          error: 'Invalid file access ticket signature.',
          expiresAt: 'later',
          ipAddress: '203.0.113.10',
          sourceSurface: null,
          ticketId: 'ticket-1',
          userAgent: null,
        },
        {
          outcome: 'failure',
          severity: 'warning',
        },
      ),
      /expiresAt/,
    ],
  ])('rejects malformed metadata for %s', (_eventType, record, errorPattern) => {
    expect(() => validateRegulatedAuditFields(record)).toThrow(errorPattern);
  });
});
