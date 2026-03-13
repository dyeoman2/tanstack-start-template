import type { EmailEvent } from '@convex-dev/resend';
import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_EMAIL_TEMPLATE_IDS,
  buildInvitationTemplate,
  buildMagicLinkTemplate,
  buildResetPasswordTemplate,
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

describe('available email templates', () => {
  it('matches the Better Auth Infra template catalog', () => {
    expect(AVAILABLE_EMAIL_TEMPLATE_IDS).toEqual([
      'verify-email',
      'reset-password',
      'change-email',
      'sign-in-otp',
      'verify-email-otp',
      'reset-password-otp',
      'magic-link',
      'two-factor',
      'invitation',
      'application-invite',
      'delete-account',
      'stale-account-user',
      'stale-account-admin',
    ]);
  });
});

describe('email template builders', () => {
  it('builds the password reset template with reset copy and link fallback', async () => {
    const template = await buildResetPasswordTemplate({
      appName: 'Acme',
      resetLink: 'https://example.com/reset?token=123',
      userName: 'Casey',
    });

    expect(template.subject).toBe('Reset your Acme password');
    expect(template.html).toContain('Reset Password');
    expect(template.html).toContain('https://example.com/reset?token=123');
    expect(template.html).toContain(
      'display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0',
    );
    expect(template.html).toContain('role="presentation"');
    expect(template.text).toContain('This password reset link will expire in 1 hour.');
    expect(template.text).toContain('Need help? support@example.com.');
  });

  it('builds the invitation template with inviter, organization, and role copy', async () => {
    const template = await buildInvitationTemplate({
      appName: 'Acme',
      inviteUrl: 'https://example.com/invite/123',
      inviterName: 'Pat',
      organizationName: 'Ops',
      role: 'admin',
    });

    expect(template.subject).toBe('Pat invited you to join Ops');
    expect(template.html).toContain('Accept Invitation');
    expect(template.text).toContain('Pat invited you to join Ops on Acme as admin.');
  });

  it('builds the magic-link template as a link-based sign-in email', async () => {
    const template = await buildMagicLinkTemplate({
      appName: 'Acme',
      magicLink: 'https://example.com/magic/123',
      userName: null,
    });

    expect(template.subject).toBe('Sign in to Acme');
    expect(template.html).toContain('Use your magic link to sign in');
    expect(template.text).toContain('Sign In https://example.com/magic/123');
    expect(template.text).toContain('If you did not request this link');
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
