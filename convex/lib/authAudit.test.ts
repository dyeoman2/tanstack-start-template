import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    session?: { activeOrganizationId?: string | null; impersonatedBy?: string | null };
    user?: { email?: string; id?: string };
  } | null;
}) {
  const method = options.method ?? 'POST';
  const headers = new Headers({
    'user-agent': 'vitest',
    'x-forwarded-for': '203.0.113.10',
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
    for (const handler of AUTH_AUDIT_ALL_HANDLER_REGISTRY) {
      for (const eventType of handler.events) {
        coveredEvents.add(eventType);
      }
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
      identifier: 'user@example.com',
      organizationId: 'org_1',
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
    expect(parseMetadata(events[0].metadata)).toMatchObject({
      method: 'POST',
      path: '/sign-in/email',
      sessionId: 'sess_1',
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
    });
    expect(parseMetadata(result.events[0].metadata)).toMatchObject({
      method: 'POST',
      path: '/request-password-reset',
    });
  });

  it('emits account events with actor details in metadata only', async () => {
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
      userId: 'user_owner',
    });
    expect((result.events[0] as { actorUserId?: string }).actorUserId).toBeUndefined();
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
    expect(parseMetadata(result.events[1].metadata)).toMatchObject({
      actorUserId: 'user_admin',
      invitationId: 'invite_1',
      method: 'POST',
      path: '/organization/accept-invitation',
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
