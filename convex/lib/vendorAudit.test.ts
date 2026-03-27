import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeVendorOperation, recordVendorAccessUsed } from './vendorAudit';

const ORIGINAL_ENV = { ...process.env };

function createCtx() {
  return {
    runMutation: vi.fn(async (_mutation: unknown, args: unknown) => args),
  };
}

describe('vendorAudit', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_DEPLOYMENT_ENV: 'production',
      NODE_ENV: 'production',
    };
    delete process.env.ENABLE_GOOGLE_FAVICON_EGRESS;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.BETTER_AUTH_GOOGLE_CLIENT_ID;
    delete process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('records vendor access on successful wrapped operations', async () => {
    const ctx = createCtx();

    await executeVendorOperation(
      ctx as never,
      {
        emitter: 'chat.run_worker',
        initiatedByUserId: 'user-1',
        kind: 'system',
        organizationId: 'org-1',
        sourceSurface: 'chat.run_generation',
        userId: 'user-1',
      },
      {
        context: {
          runId: 'run-1',
        },
        dataClasses: ['chat_metadata'],
        operation: 'chat_generation',
        vendor: 'openrouter',
        execute: async () => 'ok',
      },
    );

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'outbound_vendor_access_used',
        resourceId: 'openrouter',
      }),
    );
    const usedEvent = ctx.runMutation.mock.calls[0]?.[1] as { metadata: string } | undefined;
    expect(usedEvent).toBeDefined();
    expect(JSON.parse(usedEvent!.metadata)).toEqual({
      context: {
        runId: 'run-1',
      },
      dataClasses: ['chat_metadata'],
      operation: 'chat_generation',
      sourceSurface: 'chat.run_generation',
      vendor: 'openrouter',
    });
  });

  it('records denied vendor access when approval fails before execution', async () => {
    const ctx = createCtx();

    await expect(
      executeVendorOperation(
        ctx as never,
        {
          actorUserId: 'user-1',
          emitter: 'chat.fetch_source_favicon',
          kind: 'user',
          organizationId: 'org-1',
          sourceSurface: 'chat.source_favicon',
          userId: 'user-1',
        },
        {
          context: {
            hostname: 'example.com',
          },
          dataClasses: ['public_web_metadata'],
          operation: 'source_favicon_fetch',
          vendor: 'google_favicons',
          execute: async () => 'nope',
        },
      ),
    ).rejects.toThrow();

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'outbound_vendor_access_denied',
        resourceId: 'google_favicons',
      }),
    );
  });

  it('allows explicit used-event outcomes to be marked as failures', async () => {
    const ctx = createCtx();

    await recordVendorAccessUsed(
      ctx as never,
      {
        actorUserId: 'user-1',
        emitter: 'chat.fetch_source_favicon',
        kind: 'user',
        organizationId: 'org-1',
        sourceSurface: 'chat.source_favicon',
        userId: 'user-1',
      },
      {
        decision: {
          vendor: 'google_favicons',
          dataClasses: ['public_web_metadata'],
        },
        operation: 'source_favicon_fetch',
        outcome: 'failure',
        severity: 'warning',
        context: {
          failureReason: 'too_large',
          hostname: 'example.com',
        },
      },
    );

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'outbound_vendor_access_used',
        outcome: 'failure',
        severity: 'warning',
      }),
    );
    const failureEvent = ctx.runMutation.mock.calls[0]?.[1] as { metadata: string } | undefined;
    expect(failureEvent).toBeDefined();
    expect(JSON.parse(failureEvent!.metadata)).toEqual({
      context: {
        failureReason: 'too_large',
        hostname: 'example.com',
      },
      dataClasses: ['public_web_metadata'],
      operation: 'source_favicon_fetch',
      sourceSurface: 'chat.source_favicon',
      vendor: 'google_favicons',
    });
  });

  it('supports config-gated Google Workspace OAuth dependency auditing', async () => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    const ctx = createCtx();

    await executeVendorOperation(
      ctx as never,
      {
        actorUserId: 'user-1',
        emitter: 'auth.lifecycle',
        kind: 'user',
        sourceSurface: 'auth.google_workspace_hosted_domain',
        userId: 'user-1',
      },
      {
        context: {
          oauthProvider: 'google',
          tokenType: 'id_token',
        },
        dataClasses: ['account_metadata'],
        operation: 'hosted_domain_verification',
        vendor: 'google_workspace_oauth',
        execute: async () => 'acmehealth.org',
        resolveUsedAudit: (hostedDomain) => ({
          context: {
            hostedDomainResolved: hostedDomain !== null,
          },
        }),
      },
    );

    const usedEvent = ctx.runMutation.mock.calls[0]?.[1] as { metadata: string } | undefined;
    expect(usedEvent).toBeDefined();
    expect(JSON.parse(usedEvent!.metadata)).toEqual({
      context: {
        hostedDomainResolved: true,
        oauthProvider: 'google',
        tokenType: 'id_token',
      },
      dataClasses: ['account_metadata'],
      operation: 'hosted_domain_verification',
      sourceSurface: 'auth.google_workspace_hosted_domain',
      vendor: 'google_workspace_oauth',
    });
  });
});
