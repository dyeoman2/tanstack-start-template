import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_PROXY_IP_HEADER } from '../../src/lib/server/better-auth/http';
import { AUTH_AUDIT_EVENT_TYPES } from '../../src/lib/shared/auth-audit';
import {
  AUTH_AUDIT_ALL_HANDLER_REGISTRY,
  type AuthAuditEndpointContext,
  buildSessionCreateAuditRecordsForTesting,
  buildUserCreateAuditRecordsForTesting,
  maybeWarnOnUnmappedAuditEndpointForTesting,
  processAuthAuditAfterHookForTesting,
  resetUnmappedAuditWarningsForTesting,
} from './authAudit';

function createTestContext(options: {
  body?: Record<string, unknown>;
  method?: string;
  path: string;
  returned?: unknown;
  session?: {
    session?: {
      id?: string | null;
      activeOrganizationId?: string | null;
      impersonatedBy?: string | null;
    };
    user?: { email?: string; id?: string };
  } | null;
}) {
  const method = options.method ?? 'POST';
  const headers = new Headers({
    'user-agent': 'vitest',
    [AUTH_PROXY_IP_HEADER]: '203.0.113.10',
  });

  return {
    body: options.body,
    context: {
      newSession: null,
      returned:
        options.returned ??
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      session: options.session ?? null,
    },
    headers,
    path: options.path,
    request: new Request(`https://example.com${options.path}`, {
      method,
      headers,
    }),
  } as AuthAuditEndpointContext;
}

function parseMetadata(metadata: string | undefined) {
  expect(metadata).toBeDefined();
  return JSON.parse(metadata ?? '{}') as Record<string, unknown>;
}

describe('auth audit coverage', () => {
  it('keeps every supported event represented in the handler registry', () => {
    const coveredEvents = new Set<string>();
    const manuallyRecordedEvents = [
      'domain_added',
      'domain_verification_succeeded',
      'domain_verification_failed',
      'domain_verification_token_regenerated',
      'domain_removed',
      'organization_policy_updated',
      'enterprise_auth_mode_updated',
      'enterprise_break_glass_used',
      'support_access_granted',
      'support_access_revoked',
      'support_access_used',
      'enterprise_login_succeeded',
      'enterprise_scim_token_generated',
      'enterprise_scim_token_deleted',
      'evidence_report_generated',
      'evidence_report_exported',
      'evidence_report_reviewed',
      'scim_member_deprovisioned',
      'scim_member_reactivated',
      'scim_member_deprovision_failed',
      'bulk_invite_revoked',
      'bulk_invite_resent',
      'bulk_member_removed',
      'member_suspended',
      'member_deactivated',
      'member_reactivated',
      'outbound_vendor_access_denied',
      'outbound_vendor_access_used',
      'mfa_enrollment_enforced',
      'email_verification_enforced',
      'account_locked_out',
      'admin_step_up_challenged',
      'step_up_challenge_required',
      'step_up_challenge_completed',
      'step_up_challenge_failed',
      'step_up_consumed',
      'backup_restore_drill_completed',
      'backup_restore_drill_failed',
      'security_review_run_finalized',
      'authorization_denied',
      'admin_user_sessions_viewed',
      'ai_model_catalog_imported',
      'ai_model_created',
      'ai_model_updated',
      'ai_model_active_state_changed',
      'directory_exported',
      'audit_log_exported',
      'audit_ledger_viewed',
      'audit_ledger_segment_archived',
      'security_control_evidence_created',
      'security_control_evidence_reviewed',
      'security_control_evidence_archived',
      'security_control_evidence_renewed',
      'chat_thread_created',
      'chat_thread_deleted',
      'chat_attachment_uploaded',
      'chat_attachment_scan_passed',
      'chat_attachment_scan_failed',
      'chat_attachment_quarantined',
      'chat_attachment_deleted',
      'attachment_access_url_issued',
      'file_access_ticket_issued',
      'file_access_redeemed',
      'file_access_redeem_failed',
      'pdf_parse_requested',
      'pdf_parse_succeeded',
      'pdf_parse_failed',
      'retention_hold_applied',
      'retention_hold_released',
      'retention_purge_completed',
      'retention_purge_failed',
      'retention_purge_skipped_on_hold',
      'chat_run_completed',
      'chat_run_failed',
      'chat_web_search_used',
      'audit_archive_verification_failed',
      'audit_archive_verification_recovered',
    ] as const;
    for (const handler of AUTH_AUDIT_ALL_HANDLER_REGISTRY) {
      for (const eventType of handler.events) {
        coveredEvents.add(eventType);
      }
    }

    for (const eventType of manuallyRecordedEvents) {
      coveredEvents.add(eventType);
    }

    expect(Array.from(coveredEvents).sort()).toEqual([...AUTH_AUDIT_EVENT_TYPES].sort());
    for (const handler of AUTH_AUDIT_ALL_HANDLER_REGISTRY) {
      expect(handler.events.length).toBeGreaterThan(0);
    }
  });
});

describe('auth audit handlers', () => {
  it('records sign-up hooks with normalized metadata', async () => {
    const events = await buildUserCreateAuditRecordsForTesting(
      { email: 'User@Example.com', id: 'user_1' },
      {
        body: { organizationId: 'org_1' },
        headers: new Headers({ 'user-agent': 'vitest' }),
        path: '/sign-up/email',
        request: new Request('https://example.com/sign-up/email', { method: 'POST' }),
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'user_signed_up',
      actorUserId: 'user_1',
      targetUserId: 'user_1',
      identifier: 'user@example.com',
      organizationId: 'org_1',
      outcome: 'success',
      resourceType: 'user',
      sourceSurface: 'auth.endpoint.sign_up',
      userId: 'user_1',
    });
    expect(parseMetadata(events[0].metadata)).toMatchObject({
      method: 'POST',
      path: '/sign-up/email',
    });
  });

  it('records session creation hooks for sign-in flows', async () => {
    const events = await buildSessionCreateAuditRecordsForTesting(
      {
        id: 'sess_1',
        ipAddress: '198.51.100.10',
        userAgent: 'hook-agent',
        userId: 'user_1',
      },
      {
        body: { organizationId: 'org_1' },
        context: {
          internalAdapter: {
            findUserById: vi.fn(async () => ({ email: 'user@example.com', id: 'user_1' })),
          },
        },
        headers: new Headers(),
        path: '/sign-in/email',
        request: new Request('https://example.com/sign-in/email', { method: 'POST' }),
      },
    );

    expect(events.map((event) => event.eventType)).toEqual(['session_created', 'user_signed_in']);
    expect(events[0]).toMatchObject({
      actorUserId: 'user_1',
      targetUserId: 'user_1',
      sessionId: 'sess_1',
      outcome: 'success',
      severity: 'info',
      resourceType: 'session',
      sourceSurface: 'auth.session.create',
    });
    expect(events[1]).toMatchObject({
      actorUserId: 'user_1',
      targetUserId: 'user_1',
      sessionId: 'sess_1',
      outcome: 'success',
      severity: 'info',
      resourceType: 'session',
      sourceSurface: 'auth.endpoint.sign_in',
    });
    expect(parseMetadata(events[0].metadata)).toMatchObject({
      method: 'POST',
      path: '/sign-in/email',
    });
  });

  it('emits verification events from endpoint handlers', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        body: { email: 'Reset@Example.com' },
        path: '/request-password-reset',
      }),
    );

    expect(result.matchedHandlerNames).toEqual(['verification.password-reset-requested']);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventType: 'password_reset_requested',
      identifier: 'reset@example.com',
      outcome: 'success',
      severity: 'info',
      resourceType: 'verification_token',
      sourceSurface: 'auth.endpoint.password_reset',
    });
    expect(parseMetadata(result.events[0].metadata)).toMatchObject({
      method: 'POST',
      path: '/request-password-reset',
    });
  });

  it('emits account events with structured actor provenance', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        body: { accountId: 'acct_1', providerId: 'github' },
        path: '/unlink-account',
        session: {
          user: { email: 'owner@example.com', id: 'user_owner' },
        },
      }),
    );

    expect(result.matchedHandlerNames).toEqual(['account.unlinked']);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventType: 'account_unlinked',
      actorUserId: 'user_owner',
      outcome: 'success',
      severity: 'info',
      resourceType: 'account',
      resourceId: 'acct_1',
      sourceSurface: 'auth.endpoint.account',
      userId: 'user_owner',
    });
    expect(parseMetadata(result.events[0].metadata)).toMatchObject({
      accountId: 'acct_1',
      method: 'POST',
      path: '/unlink-account',
      providerId: 'github',
    });
  });

  it('emits multi-event organization flows for invitation acceptance', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        path: '/organization/accept-invitation',
        returned: {
          invitation: { email: 'invitee@example.com', id: 'invite_1' },
          organizationId: 'org_1',
          userId: 'user_invitee',
        },
        session: {
          user: { email: 'admin@example.com', id: 'user_admin' },
        },
      }),
    );

    expect(result.matchedHandlerNames).toEqual(['organization.invitation-accepted']);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'invite_accepted',
      'member_added',
    ]);
    expect(result.events[1]).toMatchObject({
      actorUserId: 'user_admin',
      targetUserId: 'user_invitee',
      outcome: 'success',
      severity: 'info',
      resourceType: 'organization_membership',
      sourceSurface: 'auth.endpoint.organization',
    });
    expect(parseMetadata(result.events[1].metadata)).toMatchObject({
      invitationId: 'invite_1',
      method: 'POST',
      path: '/organization/accept-invitation',
    });
  });

  it('records sign-in denials through the shared Better Auth audit path', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        body: { email: 'user@example.com', password: 'secret' },
        path: '/sign-in/email',
        returned: new Response(
          JSON.stringify({
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      actorUserId: 'anonymous:user@example.com',
      eventType: 'authorization_denied',
      identifier: 'user@example.com',
      outcome: 'failure',
      resourceId: '/sign-in/email',
      resourceLabel: 'Sign-in denied',
      resourceType: 'session',
      severity: 'warning',
      sourceSurface: 'auth.endpoint.sign_in',
    });
    expect(parseMetadata(result.events[0].metadata)).toMatchObject({
      attemptedIdentifier: 'user@example.com',
      path: '/sign-in/email',
      permission: 'auth_endpoint_access',
      reason: 'INVALID_CREDENTIALS',
      responseErrorCode: 'INVALID_CREDENTIALS',
      responseErrorMessage: 'Invalid email or password',
      responseStatus: 401,
    });
  });

  it('records password reset denials through the shared Better Auth audit path', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        body: { email: 'reset@example.com' },
        path: '/reset-password',
        returned: new Response(
          JSON.stringify({
            code: 'BAD_REQUEST',
            message: 'Reset token expired',
          }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        ),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      actorUserId: 'anonymous:reset@example.com',
      eventType: 'authorization_denied',
      resourceId: '/reset-password',
      identifier: 'reset@example.com',
      resourceLabel: 'Password reset denied',
      resourceType: 'verification_token',
      sourceSurface: 'auth.endpoint.password_reset',
    });
  });

  it('records email verification denials through the shared Better Auth audit path', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        path: '/verify-email',
        returned: new Response(
          JSON.stringify({
            code: 'FORBIDDEN',
            message: 'Verification token invalid',
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        ),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      actorUserId: 'anonymous',
      eventType: 'authorization_denied',
      resourceId: '/verify-email',
      resourceLabel: 'Email verification denied',
      resourceType: 'verification_token',
      sourceSurface: 'auth.endpoint.email_verification',
    });
  });

  it('records failed organization invitation acceptance through the shared Better Auth audit path', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        body: { invitationId: 'invite_1' },
        path: '/organization/accept-invitation',
        returned: new Response(
          JSON.stringify({
            code: 'FORBIDDEN',
            message: 'Organization join not allowed',
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        ),
        session: {
          user: { email: 'invitee@example.com', id: 'user_invitee' },
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      actorUserId: 'user_invitee',
      eventType: 'authorization_denied',
      resourceId: 'invite_1',
      resourceLabel: 'Invitation acceptance denied',
      resourceType: 'organization_membership',
      sourceSurface: 'auth.endpoint.organization',
    });
  });

  it('emits a single denial event for explicit Better Auth before-hook blocks', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        body: { email: 'blocked@example.com' },
        path: '/sign-in/email',
        returned: new Response(
          JSON.stringify({
            code: 'FORBIDDEN',
            message: 'Password sign-in is disabled for this account',
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        ),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      actorUserId: 'anonymous:blocked@example.com',
      eventType: 'authorization_denied',
      identifier: 'blocked@example.com',
      resourceId: '/sign-in/email',
      resourceLabel: 'Sign-in denied',
      sourceSurface: 'auth.endpoint.sign_in',
    });
    expect(parseMetadata(result.events[0].metadata)).toMatchObject({
      permission: 'auth_endpoint_access',
      reason: 'FORBIDDEN',
      responseErrorCode: 'FORBIDDEN',
      responseErrorMessage: 'Password sign-in is disabled for this account',
      responseStatus: 403,
    });
  });
});

describe('unmapped auth endpoint warnings', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    resetUnmappedAuditWarningsForTesting();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
    resetUnmappedAuditWarningsForTesting();
  });

  it('warns once for a successful unmapped endpoint', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        path: '/unknown-success',
        returned: { foo: 'bar' },
        session: { user: { id: 'user_1' } },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(0);
    expect(maybeWarnOnUnmappedAuditEndpointForTesting(result)).toBe(true);
    expect(maybeWarnOnUnmappedAuditEndpointForTesting(result)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Unmapped Better Auth audit endpoint',
      expect.objectContaining({
        hasSession: true,
        hasUser: true,
        method: 'POST',
        path: '/unknown-success',
        responseSummary: 'object:foo',
      }),
    );
  });

  it('does not warn for successful handled endpoints', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        path: '/sign-out',
        session: {
          user: { email: 'user@example.com', id: 'user_1' },
        },
      }),
    );

    expect(result.events).toHaveLength(1);
    expect(result.shouldWarn).toBe(false);
    expect(maybeWarnOnUnmappedAuditEndpointForTesting(result)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for failed endpoints', async () => {
    const result = await processAuthAuditAfterHookForTesting(
      createTestContext({
        path: '/unknown-failure',
        returned: new Response('bad request', { status: 400 }),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.shouldWarn).toBe(false);
    expect(maybeWarnOnUnmappedAuditEndpointForTesting(result)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
