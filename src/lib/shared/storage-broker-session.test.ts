import { describe, expect, it } from 'vitest';
import {
  createStorageBrokerSessionRequest,
  STORAGE_BROKER_SESSION_TTL_MS,
  validateStorageBrokerSessionRequest,
} from './storage-broker-session';

const SECRET = 'broker-session-secret-abcdefghijklmnopqrstuvwxyz';

describe('storage broker session assertions', () => {
  it('creates and validates a signed request for the expected tier', async () => {
    const now = Date.parse('2026-03-25T12:00:00.000Z');
    const request = await createStorageBrokerSessionRequest({
      now,
      secret: SECRET,
      tier: 'edge',
    });

    await expect(
      validateStorageBrokerSessionRequest({
        now: now + 5_000,
        request,
        secret: SECRET,
        tier: 'edge',
      }),
    ).resolves.toBeNull();
    expect(request.expiresAt).toBe(now + STORAGE_BROKER_SESSION_TTL_MS);
  });

  it('rejects tampered signatures', async () => {
    const request = await createStorageBrokerSessionRequest({
      now: Date.parse('2026-03-25T12:00:00.000Z'),
      secret: SECRET,
      tier: 'control',
    });

    await expect(
      validateStorageBrokerSessionRequest({
        now: Date.parse('2026-03-25T12:00:30.000Z'),
        request: {
          ...request,
          nonce: `${request.nonce}-tampered`,
        },
        secret: SECRET,
        tier: 'control',
      }),
    ).resolves.toBe('Storage broker session signature was invalid.');
  });

  it('rejects expired requests and tier mismatches', async () => {
    const now = Date.parse('2026-03-25T12:00:00.000Z');
    const request = await createStorageBrokerSessionRequest({
      now,
      secret: SECRET,
      tier: 'edge',
      ttlMs: 1_000,
    });

    await expect(
      validateStorageBrokerSessionRequest({
        now: now + 120_000,
        request,
        secret: SECRET,
        tier: 'edge',
      }),
    ).resolves.toBe('Storage broker session request has expired.');

    await expect(
      validateStorageBrokerSessionRequest({
        now,
        request,
        secret: SECRET,
        tier: 'control',
      }),
    ).resolves.toBe('Storage broker session tier did not match the requested endpoint.');
  });
});
