import { describe, expect, it, vi } from 'vitest';
import { createAdminOrganizationAuditPlugin } from './adminOrganizationAuditPlugin';

function getAfterHook() {
  const recordAuditEvent = vi.fn(async () => {});
  const plugin = createAdminOrganizationAuditPlugin(recordAuditEvent);
  const afterHooks = plugin.hooks?.after;
  if (!afterHooks || afterHooks.length !== 1) {
    throw new Error('Expected exactly one Better Auth after hook');
  }

  return {
    afterHook: afterHooks[0],
    recordAuditEvent,
  };
}

describe('createAdminOrganizationAuditPlugin', () => {
  it('matches admin and organization paths only', () => {
    const { afterHook } = getAfterHook();

    expect(afterHook.matcher({ path: '/admin/list-user-sessions' } as never)).toBe(true);
    expect(afterHook.matcher({ path: '/organization/remove-member' } as never)).toBe(true);
    expect(afterHook.matcher({ path: '/sign-in/email' } as never)).toBe(false);
  });

  it('records structured denial events for handled organization failures', async () => {
    const { afterHook, recordAuditEvent } = getAfterHook();
    const headers = new Headers({
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.9',
    });

    await afterHook.handler({
      body: {
        email: 'member@example.com',
        invitationId: 'invite_1',
      },
      context: {
        returned: new Response(
          JSON.stringify({
            code: 'FORBIDDEN',
            message: 'Invitation rejection not allowed',
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' },
          },
        ),
        session: {
          user: {
            id: 'user_admin',
          },
        },
      },
      headers,
      path: '/organization/reject-invitation',
      request: new Request('https://example.com/organization/reject-invitation', {
        headers,
        method: 'POST',
      }),
    } as never);

    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user_admin',
        eventType: 'authorization_denied',
        identifier: 'member@example.com',
        ipAddress: '203.0.113.9',
        outcome: 'failure',
        resourceId: 'invite_1',
        resourceLabel: 'Authorization denied',
        resourceType: 'organization_membership',
        severity: 'warning',
        sourceSurface: 'auth.endpoint.organization',
        userAgent: 'vitest',
      }),
    );
  });

  it('records invitation acceptance denials through the shared auth denial audit path', async () => {
    const { afterHook, recordAuditEvent } = getAfterHook();

    await afterHook.handler({
      context: {
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
      },
      path: '/organization/accept-invitation',
    } as never);

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'authorization_denied',
        resourceLabel: 'Invitation acceptance denied',
        resourceType: 'organization_membership',
        sourceSurface: 'auth.endpoint.organization',
      }),
    );
  });
});
