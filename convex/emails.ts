import { Resend as ConvexResend, type EmailEvent, vEmailEvent, vEmailId } from '@convex-dev/resend';
import { v } from 'convex/values';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { components, internal } from './_generated/api';
import { internalAction, internalMutation, query } from './_generated/server';
import {
  buildInvitationTemplate,
  buildResetPasswordTemplate,
  buildVerifyEmailTemplate,
  type EmailTemplateId,
} from './emailTemplates';
import { emailServiceConfiguredValidator, successTrueValidator } from './lib/returnValidators';

export {
  AVAILABLE_EMAIL_TEMPLATE_IDS,
  buildApplicationInviteTemplate,
  buildChangeEmailTemplate,
  buildDeleteAccountTemplate,
  buildInvitationTemplate,
  buildMagicLinkTemplate,
  buildResetPasswordOtpTemplate,
  buildResetPasswordTemplate,
  buildSignInOtpTemplate,
  buildStaleAccountAdminTemplate,
  buildStaleAccountUserTemplate,
  buildTwoFactorTemplate,
  buildVerifyEmailOtpTemplate,
  buildVerifyEmailTemplate,
} from './emailTemplates';

/**
 * Email utilities for Convex using the official @convex-dev/resend component
 * Provides queueing, batching, durable execution, and webhook-backed status updates.
 */

export const resend: ConvexResend = new ConvexResend(components.resend, {
  testMode: false,
  onEmailEvent: internal.emails.handleResendEmailEvent,
});

export function toEmailEventTimestamp(value: string) {
  return new Date(value).getTime();
}

export function deriveOnboardingStatusFromEmailEvent(event: EmailEvent): {
  status: OnboardingStatus | null;
  deliveryError: string | null;
} {
  switch (event.type) {
    case 'email.sent':
      return {
        status: 'email_sent',
        deliveryError: null,
      };
    case 'email.delivered':
      return {
        status: 'delivered',
        deliveryError: null,
      };
    case 'email.delivery_delayed':
      return {
        status: 'delivery_delayed',
        deliveryError: null,
      };
    case 'email.bounced':
      return {
        status: 'bounced',
        deliveryError: event.data.bounce.message,
      };
    default:
      return {
        status: null,
        deliveryError: null,
      };
  }
}

export function shouldApplyOnboardingDeliveryEvent(args: {
  currentStatus: OnboardingStatus | undefined;
  currentUpdatedAt: number | undefined;
  incomingOccurredAt: number;
}) {
  if (args.currentStatus === 'completed') {
    return false;
  }

  if (args.currentUpdatedAt !== undefined && args.incomingOccurredAt < args.currentUpdatedAt) {
    return false;
  }

  return true;
}

/**
 * Check if email service is configured (for UI validation)
 */
export const checkEmailServiceConfigured = query({
  args: {},
  returns: emailServiceConfiguredValidator,
  handler: async () => {
    const resendApiKey = process.env.RESEND_API_KEY;
    return {
      isConfigured: !!resendApiKey,
      message: resendApiKey
        ? null
        : 'Email service is not configured. Password reset functionality is unavailable.',
    };
  },
});

type EmailHeader = {
  name: string;
  value: string;
};

type EmailTag = {
  name: string;
  value: string;
};

function getSupportEmail() {
  return (
    process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_EMAIL_SENDER || 'support@example.com'
  );
}

function buildEmailHeaders(templateId: EmailTemplateId, appName: string): EmailHeader[] {
  return [
    { name: 'X-Transactional-Email', value: 'true' },
    { name: 'X-Email-Template', value: templateId },
    { name: 'X-App-Name', value: appName },
  ];
}

function buildEmailTags(templateId: EmailTemplateId, appName: string): EmailTag[] {
  return [
    { name: 'template', value: templateId },
    {
      name: 'app',
      value:
        appName
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '-')
          .replaceAll(/^-|-$/g, '') || 'app',
    },
    { name: 'category', value: 'transactional' },
  ];
}

async function sendEmailViaResendApi(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string[];
  headers?: EmailHeader[];
  tags?: EmailTag[];
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      reply_to: args.replyTo,
      headers: args.headers,
      tags: args.tags,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    message?: string;
    name?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? `Resend API request failed with ${response.status}`);
  }

  if (!payload?.id) {
    throw new Error('Resend did not return a message id');
  }

  return payload.id;
}

export const sendPasswordResetEmailMutation = internalAction({
  args: {
    user: v.object({
      id: v.string(),
      email: v.string(),
      name: v.union(v.string(), v.null()),
    }),
    url: v.string(),
    token: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    void args.token;
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }

    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const supportEmail = getSupportEmail();
    const headers = buildEmailHeaders('reset-password', appName);
    const tags = buildEmailTags('reset-password', appName);
    const content = await buildResetPasswordTemplate({
      appName,
      resetLink: args.url,
      userName: args.user.name,
    });
    const sentAt = Date.now();

    try {
      const emailId = await resend.sendEmailManually(
        ctx,
        {
          from: `${appName} <${emailSender}>`,
          to: args.user.email,
          subject: `Reset your ${appName} password`,
          replyTo: [supportEmail],
          headers,
        },
        async () => {
          return await sendEmailViaResendApi({
            apiKey: resendApiKey,
            from: `${appName} <${emailSender}>`,
            to: args.user.email,
            subject: `Reset your ${appName} password`,
            html: content.html,
            text: content.text,
            replyTo: [supportEmail],
            headers,
            tags,
          });
        },
      );

      const queuedEmail = await resend.get(ctx, emailId);
      await ctx.runMutation(internal.users.setAuthUserOnboardingState, {
        authUserId: args.user.id,
        onboardingStatus: 'email_sent',
        onboardingEmailId: emailId,
        onboardingEmailMessageId: queuedEmail?.resendId,
        onboardingEmailLastSentAt: sentAt,
        onboardingDeliveryUpdatedAt: sentAt,
        onboardingDeliveryError: null,
      });
      return { success: true };
    } catch (error) {
      await ctx.runMutation(internal.users.setAuthUserOnboardingState, {
        authUserId: args.user.id,
        onboardingStatus: 'email_pending',
        onboardingEmailId: null,
        onboardingEmailMessageId: null,
        onboardingEmailLastSentAt: sentAt,
        onboardingDeliveryError:
          error instanceof Error ? error.message : 'Failed to send password reset email',
      });
      throw error;
    }
  },
});

export const sendVerificationEmailMutation = internalAction({
  args: {
    user: v.object({
      id: v.string(),
      email: v.string(),
      name: v.union(v.string(), v.null()),
    }),
    url: v.string(),
    token: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }

    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const supportEmail = getSupportEmail();
    const headers = buildEmailHeaders('verify-email', appName);
    const tags = buildEmailTags('verify-email', appName);
    const content = await buildVerifyEmailTemplate({
      appName,
      verificationLink: args.url,
      userName: args.user.name,
    });

    await resend.sendEmailManually(
      ctx,
      {
        from: `${appName} <${emailSender}>`,
        to: args.user.email,
        subject: content.subject,
        replyTo: [supportEmail],
        headers,
      },
      async () => {
        return await sendEmailViaResendApi({
          apiKey: resendApiKey,
          from: `${appName} <${emailSender}>`,
          to: args.user.email,
          subject: content.subject,
          html: content.html,
          text: content.text,
          replyTo: [supportEmail],
          headers,
          tags,
        });
      },
    );

    return { success: true };
  },
});

export const sendOrganizationInviteEmailMutation = internalMutation({
  args: {
    email: v.string(),
    inviteUrl: v.string(),
    inviterName: v.string(),
    organizationName: v.string(),
    role: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const supportEmail = getSupportEmail();
    const content = await buildInvitationTemplate({
      appName,
      inviteUrl: args.inviteUrl,
      inviterName: args.inviterName,
      organizationName: args.organizationName,
      role: args.role,
    });

    await resend.sendEmail(ctx, {
      from: `${appName} <${emailSender}>`,
      to: args.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: [supportEmail],
      headers: buildEmailHeaders('invitation', appName),
    });

    return { success: true };
  },
});

export const handleResendEmailEvent = internalMutation({
  args: {
    id: vEmailId,
    event: vEmailEvent,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const occurredAt = toEmailEventTimestamp(args.event.created_at);
    const messageId = args.event.data.email_id;
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_onboarding_email_id', (q) => q.eq('onboardingEmailId', args.id))
      .first();

    await ctx.db.insert('emailLifecycleEvents', {
      messageId,
      emailId: args.id,
      email:
        profile?.email ??
        (Array.isArray(args.event.data.to) ? args.event.data.to[0] : args.event.data.to),
      category: 'onboarding',
      eventType: args.event.type,
      rawPayload: JSON.stringify(args.event),
      occurredAt,
      createdAt: Date.now(),
      ...(profile?.authUserId ? { authUserId: profile.authUserId } : {}),
    });

    if (!profile) {
      return null;
    }

    const next = deriveOnboardingStatusFromEmailEvent(args.event);
    if (next.status === null) {
      if (!profile.onboardingEmailMessageId) {
        await ctx.db.patch(profile._id, {
          onboardingEmailMessageId: messageId,
          lastSyncedAt: Date.now(),
        });
      }
      return null;
    }

    if (
      !shouldApplyOnboardingDeliveryEvent({
        currentStatus: profile.onboardingStatus,
        currentUpdatedAt: profile.onboardingDeliveryUpdatedAt,
        incomingOccurredAt: occurredAt,
      })
    ) {
      return null;
    }

    await ctx.db.patch(profile._id, {
      onboardingStatus: next.status,
      onboardingEmailMessageId: messageId,
      onboardingDeliveryUpdatedAt: occurredAt,
      onboardingDeliveryError: next.deliveryError,
      lastSyncedAt: Date.now(),
    });

    return null;
  },
});

export const sendPasswordResetEmail = internalAction({
  args: {
    user: v.object({
      id: v.string(),
      email: v.string(),
      name: v.union(v.string(), v.null()),
    }),
    url: v.string(),
    token: v.string(),
  },
  returns: successTrueValidator,
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.emails.sendPasswordResetEmailMutation, args);
    return { success: true };
  },
});
