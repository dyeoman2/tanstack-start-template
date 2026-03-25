import { describe, expect, it, vi } from 'vitest';
import {
  recordScimAuditEvent,
  recordSiteAdminAuditEvent,
  recordSystemAuditEvent,
  recordUserAuditEvent,
} from './auditEmitters';

function createCtx() {
  return {
    runMutation: vi.fn(async (_mutation, args) => args),
  };
}

describe('audit emitters', () => {
  it('binds user provenance from trusted user inputs', async () => {
    const ctx = createCtx();

    await recordUserAuditEvent(ctx, {
      actorIdentifier: 'user@example.com',
      actorUserId: 'user_1',
      emitter: 'chat.thread',
      eventType: 'chat_thread_created',
      sourceSurface: 'chat.precreate_thread',
      userId: 'user_1',
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: 'user_1',
        provenance: expect.objectContaining({
          kind: 'user',
          emitter: 'chat.thread',
          actorUserId: 'user_1',
          identifier: 'user@example.com',
        }),
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        actorIdentifier: expect.anything(),
        emitter: expect.anything(),
      }),
    );
  });

  it('binds site admin provenance separately from user provenance', async () => {
    const ctx = createCtx();

    await recordSiteAdminAuditEvent(ctx, {
      actorUserId: 'admin_1',
      emitter: 'security.reports',
      eventType: 'evidence_report_reviewed',
      sourceSurface: 'admin.security',
      userId: 'admin_1',
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provenance: expect.objectContaining({
          kind: 'site_admin',
          emitter: 'security.reports',
          actorUserId: 'admin_1',
        }),
      }),
    );
  });

  it('records system provenance with initiator attribution', async () => {
    const ctx = createCtx();

    await recordSystemAuditEvent(ctx, {
      emitter: 'chat.run_worker',
      eventType: 'chat_run_completed',
      initiatedByUserId: 'user_1',
      sourceSurface: 'chat.run_generation',
      userId: 'user_1',
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provenance: expect.objectContaining({
          kind: 'system',
          emitter: 'chat.run_worker',
          initiatedByUserId: 'user_1',
        }),
      }),
    );
  });

  it('records scim service provenance with provider binding', async () => {
    const ctx = createCtx();

    await recordScimAuditEvent(ctx, {
      emitter: 'auth.scim',
      eventType: 'scim_member_deprovisioned',
      scimProviderId: 'provider_1',
      sourceSurface: 'auth.scim',
      userId: 'user_1',
    });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provenance: expect.objectContaining({
          kind: 'scim_service',
          emitter: 'auth.scim',
          scimProviderId: 'provider_1',
        }),
      }),
    );
  });
});
