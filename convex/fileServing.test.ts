import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createDownloadPresignedStorageUrlMock } = vi.hoisted(() => ({
  createDownloadPresignedStorageUrlMock: vi.fn(),
}));

vi.mock('../src/lib/server/env.server', () => ({
  getStorageRuntimeConfig: vi.fn(() => ({
    fileServeSigningSecret: 'test-file-serve-secret',
  })),
}));

vi.mock('./lib/storageS3', () => ({
  createDownloadPresignedStorageUrl: createDownloadPresignedStorageUrlMock,
}));

import { recordFileAccessRedeemFailure, redeemFileAccessTicketOrThrow } from './fileServing';

function makeTicket() {
  return {
    createdAt: Date.parse('2026-03-25T10:00:00.000Z'),
    expiresAt: Date.parse('2026-03-25T10:15:00.000Z'),
    ipAddress: '203.0.113.10',
    issuedFromSessionId: 'session_123',
    issuedToUserId: 'user_123',
    organizationId: 'org_123',
    purpose: 'interactive_open',
    redeemedAt: Date.parse('2026-03-25T10:05:00.000Z'),
    sourceSurface: 'file.serve_url_create',
    storageId: 'storage_123',
    ticketId: 'ticket_123',
    userAgent: 'Vitest',
  };
}

function makeLifecycle() {
  return {
    backendMode: 's3-primary',
    canonicalBucket: 'bucket',
    canonicalKey: 'clean/org/org_123/chat_attachment/storage_123',
    deletedAt: undefined,
    inspectionStatus: 'PASSED',
    malwareStatus: 'CLEAN',
    mirrorBucket: undefined,
    mirrorKey: undefined,
    sourceType: 'stored_file',
    storagePlacement: 'PROMOTED',
  };
}

async function createSignature(ticketId: string, expiresAt: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('test-file-serve-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`file_ticket:${ticketId}:${expiresAt}`),
  );
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, '0')).join(
    '',
  );
}

describe('redeemFileAccessTicketOrThrow', () => {
  beforeEach(() => {
    createDownloadPresignedStorageUrlMock.mockReset();
    createDownloadPresignedStorageUrlMock.mockResolvedValue({
      expiresAt: Date.parse('2026-03-25T10:06:00.000Z'),
      url: 'https://download.example.test/presigned',
    });
  });

  it('passes the authenticated user and session into the authorized redemption mutation', async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await createSignature('ticket_123', expiresAt);
    const runMutation = vi.fn().mockResolvedValueOnce(makeTicket()).mockResolvedValueOnce(null);
    const runQuery = vi.fn().mockResolvedValue(makeLifecycle());

    const redirect = await redeemFileAccessTicketOrThrow(
      {
        runMutation,
        runQuery,
      },
      {
        authenticatedSessionId: 'session_123',
        authenticatedUserId: 'user_123',
        expiresAt,
        requestIpAddress: '198.51.100.10',
        requestUserAgent: 'Vitest Browser',
        signature,
        ticketId: 'ticket_123',
      },
    );

    expect(redirect).toEqual({
      storageId: 'storage_123',
      url: 'https://download.example.test/presigned',
    });
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      expectedSessionId: 'session_123',
      expectedUserId: 'user_123',
      redeemedAt: expect.any(Number),
      ticketId: 'ticket_123',
    });
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      eventType: 'file_access_redeemed',
      sessionId: 'session_123',
      userId: 'user_123',
    });
  });

  it('stops before redirect resolution when the authorized redemption mutation rejects', async () => {
    const expiresAt = Date.now() + 60_000;
    const signature = await createSignature('ticket_123', expiresAt);
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(
        new ConvexError('File access ticket does not belong to the current user.'),
      );
    const runQuery = vi.fn();

    await expect(
      redeemFileAccessTicketOrThrow(
        {
          runMutation,
          runQuery,
        },
        {
          authenticatedSessionId: 'session_999',
          authenticatedUserId: 'user_999',
          expiresAt,
          requestIpAddress: '198.51.100.10',
          requestUserAgent: 'Vitest Browser',
          signature,
          ticketId: 'ticket_123',
        },
      ),
    ).rejects.toThrow('File access ticket does not belong to the current user.');

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runQuery).not.toHaveBeenCalled();
    expect(createDownloadPresignedStorageUrlMock).not.toHaveBeenCalled();
  });
});

describe('recordFileAccessRedeemFailure', () => {
  it('records authenticated failure metadata for unauthorized redemption attempts', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const runQuery = vi.fn().mockResolvedValue(makeTicket());

    await recordFileAccessRedeemFailure(
      {
        runMutation,
        runQuery,
      },
      {
        authenticatedSessionId: 'session_999',
        authenticatedUserId: 'user_999',
        errorMessage: 'File access ticket does not belong to the current user.',
        expiresAt: Date.now() + 60_000,
        requestIpAddress: '198.51.100.10',
        requestUserAgent: 'Vitest Browser',
        ticketId: 'ticket_123',
      },
    );

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      eventType: 'file_access_redeem_failed',
      sessionId: 'session_999',
      userId: 'user_999',
    });
    expect(
      JSON.parse(String(runMutation.mock.calls[0]?.[1]?.metadata)) as Record<string, unknown>,
    ).toMatchObject({
      attemptedSessionId: 'session_999',
      attemptedUserId: 'user_999',
      error: 'File access ticket does not belong to the current user.',
      ticketId: 'ticket_123',
    });
  });
});
