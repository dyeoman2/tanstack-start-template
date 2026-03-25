import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { validateFileAccessTicketRedemption } from './fileAccessTickets';

function makeTicket(overrides?: Partial<Parameters<typeof validateFileAccessTicketRedemption>[0]>) {
  return {
    createdAt: Date.parse('2026-03-25T10:00:00.000Z'),
    expiresAt: Date.parse('2026-03-25T10:15:00.000Z'),
    ipAddress: '203.0.113.10',
    issuedFromSessionId: 'session_123',
    issuedToUserId: 'user_123',
    organizationId: 'org_123',
    purpose: 'interactive_open',
    redeemedAt: null,
    sourceSurface: 'file.serve_url_create',
    storageId: 'storage_123',
    ticketId: 'ticket_123',
    userAgent: 'Vitest',
    ...overrides,
  };
}

describe('validateFileAccessTicketRedemption', () => {
  it('returns a redeemed record for the rightful user and issuing session', () => {
    const redeemedAt = Date.parse('2026-03-25T10:05:00.000Z');

    expect(
      validateFileAccessTicketRedemption(makeTicket(), {
        expectedSessionId: 'session_123',
        expectedUserId: 'user_123',
        redeemedAt,
      }),
    ).toMatchObject({
      issuedFromSessionId: 'session_123',
      issuedToUserId: 'user_123',
      redeemedAt,
      ticketId: 'ticket_123',
    });
  });

  it('rejects the wrong user without consuming the ticket', () => {
    const ticket = makeTicket();

    expect(() =>
      validateFileAccessTicketRedemption(ticket, {
        expectedSessionId: 'session_123',
        expectedUserId: 'user_999',
        redeemedAt: Date.parse('2026-03-25T10:05:00.000Z'),
      }),
    ).toThrowError(new ConvexError('File access ticket does not belong to the current user.'));
    expect(ticket.redeemedAt).toBeNull();

    expect(
      validateFileAccessTicketRedemption(ticket, {
        expectedSessionId: 'session_123',
        expectedUserId: 'user_123',
        redeemedAt: Date.parse('2026-03-25T10:05:00.000Z'),
      }).redeemedAt,
    ).toBe(Date.parse('2026-03-25T10:05:00.000Z'));
  });

  it('rejects the wrong session without consuming the ticket', () => {
    const ticket = makeTicket();

    expect(() =>
      validateFileAccessTicketRedemption(ticket, {
        expectedSessionId: 'session_999',
        expectedUserId: 'user_123',
        redeemedAt: Date.parse('2026-03-25T10:05:00.000Z'),
      }),
    ).toThrowError(
      new ConvexError('File access ticket must be redeemed from the issuing session.'),
    );
    expect(ticket.redeemedAt).toBeNull();
  });

  it('rejects expired tickets before redemption', () => {
    expect(() =>
      validateFileAccessTicketRedemption(makeTicket(), {
        expectedSessionId: 'session_123',
        expectedUserId: 'user_123',
        redeemedAt: Date.parse('2026-03-25T10:16:00.000Z'),
      }),
    ).toThrowError(new ConvexError('File access ticket has expired.'));
  });

  it('rejects tickets that were already redeemed', () => {
    expect(() =>
      validateFileAccessTicketRedemption(
        makeTicket({
          redeemedAt: Date.parse('2026-03-25T10:04:00.000Z'),
        }),
        {
          expectedSessionId: 'session_123',
          expectedUserId: 'user_123',
          redeemedAt: Date.parse('2026-03-25T10:05:00.000Z'),
        },
      ),
    ).toThrowError(new ConvexError('File access ticket has already been redeemed.'));
  });
});
