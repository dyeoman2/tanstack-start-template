import { describe, expect, it } from 'vitest';
import type { EmailEvent } from '@convex-dev/resend';
import {
  deriveOnboardingStatusFromEmailEvent,
  shouldApplyOnboardingDeliveryEvent,
  toEmailEventTimestamp,
} from './emails';

function createEvent(type: EmailEvent['type']): EmailEvent {
  const base = {
    created_at: '2026-03-12T10:00:00.000Z',
    data: {
      broadcast_id: undefined,
      created_at: '2026-03-12T10:00:00.000Z',
      email_id: 're_123',
      from: 'Sender <sender@example.com>',
      to: 'user@example.com',
      cc: undefined,
      bcc: undefined,
      reply_to: undefined,
      headers: undefined,
      subject: 'Reset your password',
      tags: undefined,
    },
  };

  if (type === 'email.bounced') {
    return {
      ...base,
      type,
      data: {
        ...base.data,
        bounce: {
          message: 'Mailbox not found',
          subType: 'invalid-email',
          type: 'hard',
        },
      },
    };
  }

  return {
    ...base,
    type,
  } as EmailEvent;
}

describe('deriveOnboardingStatusFromEmailEvent', () => {
  it('maps delivered events to delivered status', () => {
    expect(deriveOnboardingStatusFromEmailEvent(createEvent('email.delivered'))).toEqual({
      status: 'delivered',
      deliveryError: null,
    });
  });

  it('maps delivery delayed events to delivery_delayed status', () => {
    expect(deriveOnboardingStatusFromEmailEvent(createEvent('email.delivery_delayed'))).toEqual({
      status: 'delivery_delayed',
      deliveryError: null,
    });
  });

  it('maps bounced events to bounced status with the provider message', () => {
    expect(deriveOnboardingStatusFromEmailEvent(createEvent('email.bounced'))).toEqual({
      status: 'bounced',
      deliveryError: 'Mailbox not found',
    });
  });
});

describe('shouldApplyOnboardingDeliveryEvent', () => {
  it('does not let provider events overwrite completed onboarding', () => {
    expect(
      shouldApplyOnboardingDeliveryEvent({
        currentStatus: 'completed',
        currentUpdatedAt: toEmailEventTimestamp('2026-03-12T11:00:00.000Z'),
        incomingOccurredAt: toEmailEventTimestamp('2026-03-12T12:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('ignores older delivery events', () => {
    expect(
      shouldApplyOnboardingDeliveryEvent({
        currentStatus: 'delivered',
        currentUpdatedAt: toEmailEventTimestamp('2026-03-12T12:00:00.000Z'),
        incomingOccurredAt: toEmailEventTimestamp('2026-03-12T11:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('accepts newer delivery events when onboarding is incomplete', () => {
    expect(
      shouldApplyOnboardingDeliveryEvent({
        currentStatus: 'email_sent',
        currentUpdatedAt: toEmailEventTimestamp('2026-03-12T10:00:00.000Z'),
        incomingOccurredAt: toEmailEventTimestamp('2026-03-12T11:00:00.000Z'),
      }),
    ).toBe(true);
  });
});
