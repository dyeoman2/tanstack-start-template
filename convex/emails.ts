import { type EmailEvent, Resend as ConvexResend, vEmailEvent, vEmailId } from '@convex-dev/resend';
import { v } from 'convex/values';
import type { OnboardingStatus } from '../src/lib/shared/onboarding';
import { components, internal } from './_generated/api';
import { action, internalAction, internalMutation, query } from './_generated/server';

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

const createBaseHtmlTemplate = (content: string, title: string, businessName: string) => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #2563eb; margin: 0; font-size: 24px;">${businessName}</h1>
        <p style="color: #6b7280; margin: 5px 0 0 0; font-size: 14px;">Get Started</p>
      </div>

      ${content}

      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">
          © ${new Date().getFullYear()} ${businessName}. All rights reserved.
        </p>
      </div>
    </body>
  </html>
`;

const createBaseTextTemplate = (content: string, businessName: string) => `
${businessName} - Get Started

${content}

© ${new Date().getFullYear()} ${businessName}. All rights reserved.
`;

async function sendEmailViaResendApi(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
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
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? `Resend API request failed with ${response.status}`);
  }

  if (!payload?.id) {
    throw new Error('Resend did not return a message id');
  }

  return payload.id;
}

function buildPasswordResetEmailContent(args: {
  appName: string;
  resetLink: string;
  userName: string | null;
}) {
  const name = args.userName || 'there';

  const htmlContent = `
    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="color: #1f2937; margin: 0 0 15px 0; font-size: 20px;">Reset your password</h2>
      <p style="margin: 0 0 15px 0; color: #4b5563;">Hi ${name},</p>
      <p style="margin: 0 0 20px 0; color: #4b5563;">
        We received a request to reset your password for your ${args.appName} account.
        If you didn't make this request, you can safely ignore this email.
      </p>
      <p style="margin: 0 0 25px 0; color: #4b5563;">
        Click the button below to reset your password. This link will expire in 1 hour for security reasons.
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${args.resetLink}"
           style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
          Reset Password
        </a>
      </div>

      <p style="margin: 25px 0 15px 0; color: #6b7280; font-size: 14px;">
        If the button doesn't work, you can copy and paste this link into your browser:
      </p>
      <p style="margin: 0; color: #2563eb; word-break: break-all; font-size: 14px;">
        ${args.resetLink}
      </p>
    </div>

    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
      <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
        This password reset link will expire in 1 hour.<br>
        If you didn't request this password reset, please ignore this email.
      </p>
    </div>
  `;

  const textContent = `
Hi ${name},

We received a request to reset your password for your ${args.appName} account.
If you didn't make this request, you can safely ignore this email.

To reset your password, please visit: ${args.resetLink}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email.
  `;

  return {
    html: createBaseHtmlTemplate(htmlContent, 'Reset your password', args.appName),
    text: createBaseTextTemplate(textContent, args.appName),
  };
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
  handler: async (ctx, args) => {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }

    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const content = buildPasswordResetEmailContent({
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
        },
        async () => {
          return await sendEmailViaResendApi({
            apiKey: resendApiKey,
            from: `${appName} <${emailSender}>`,
            to: args.user.email,
            subject: `Reset your ${appName} password`,
            html: content.html,
            text: content.text,
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
    } catch (error) {
      await ctx.runMutation(internal.users.setAuthUserOnboardingState, {
        authUserId: args.user.id,
        onboardingStatus: 'email_pending',
        onboardingEmailLastSentAt: sentAt,
        onboardingDeliveryError:
          error instanceof Error ? error.message : 'Failed to send password reset email',
      });
      throw error;
    }
  },
});

export const sendTeamInviteEmailMutation = internalMutation({
  args: {
    email: v.string(),
    inviteUrl: v.string(),
    inviterName: v.string(),
    teamName: v.string(),
    role: v.union(v.literal('admin'), v.literal('edit'), v.literal('view')),
  },
  handler: async (ctx, args) => {
    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const htmlContent = `
    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="color: #1f2937; margin: 0 0 15px 0; font-size: 20px;">Join ${args.teamName}</h2>
      <p style="margin: 0 0 15px 0; color: #4b5563;">
        ${args.inviterName} invited you to join <strong>${args.teamName}</strong> on ${appName} as
        a <strong>${args.role}</strong>.
      </p>
      <p style="margin: 0 0 25px 0; color: #4b5563;">
        Accept the invite to join the team. This invite expires in 7 days.
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${args.inviteUrl}"
           style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
          Accept Invite
        </a>
      </div>
      <p style="margin: 25px 0 15px 0; color: #6b7280; font-size: 14px;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="margin: 0; color: #2563eb; word-break: break-all; font-size: 14px;">
        ${args.inviteUrl}
      </p>
    </div>
  `;

    const textContent = `
${args.inviterName} invited you to join ${args.teamName} on ${appName} as a ${args.role}.

Accept the invite here: ${args.inviteUrl}

This invite expires in 7 days.
    `;

    await resend.sendEmail(ctx, {
      from: `${appName} <${emailSender}>`,
      to: args.email,
      subject: `${args.inviterName} invited you to join ${args.teamName}`,
      html: createBaseHtmlTemplate(htmlContent, `Join ${args.teamName}`, appName),
      text: createBaseTextTemplate(textContent, appName),
    });
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
  handler: async (ctx, args) => {
    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const htmlContent = `
    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="color: #1f2937; margin: 0 0 15px 0; font-size: 20px;">Join ${args.organizationName}</h2>
      <p style="margin: 0 0 15px 0; color: #4b5563;">
        ${args.inviterName} invited you to join <strong>${args.organizationName}</strong> on ${appName} as
        a <strong>${args.role}</strong>.
      </p>
      <p style="margin: 0 0 25px 0; color: #4b5563;">
        Accept the invite to join the organization. This invite expires in 7 days.
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${args.inviteUrl}"
           style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
          Accept Invite
        </a>
      </div>
      <p style="margin: 25px 0 15px 0; color: #6b7280; font-size: 14px;">
        If the button doesn't work, copy and paste this link into your browser:
      </p>
      <p style="margin: 0; color: #2563eb; word-break: break-all; font-size: 14px;">
        ${args.inviteUrl}
      </p>
    </div>
  `;

    const textContent = `
${args.inviterName} invited you to join ${args.organizationName} on ${appName} as a ${args.role}.

Accept the invite here: ${args.inviteUrl}

This invite expires in 7 days.
    `;

    await resend.sendEmail(ctx, {
      from: `${appName} <${emailSender}>`,
      to: args.email,
      subject: `${args.inviterName} invited you to join ${args.organizationName}`,
      html: createBaseHtmlTemplate(htmlContent, `Join ${args.organizationName}`, appName),
      text: createBaseTextTemplate(textContent, appName),
    });
  },
});

export const handleResendEmailEvent = internalMutation({
  args: {
    id: vEmailId,
    event: vEmailEvent,
  },
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
    return;
  }

  const next = deriveOnboardingStatusFromEmailEvent(args.event);
  if (next.status === null) {
    if (!profile.onboardingEmailMessageId) {
      await ctx.db.patch(profile._id, {
        onboardingEmailMessageId: messageId,
        lastSyncedAt: Date.now(),
      });
    }
    return;
  }

  if (
    !shouldApplyOnboardingDeliveryEvent({
      currentStatus: profile.onboardingStatus,
      currentUpdatedAt: profile.onboardingDeliveryUpdatedAt,
      incomingOccurredAt: occurredAt,
    })
  ) {
    return;
  }

  await ctx.db.patch(profile._id, {
    onboardingStatus: next.status,
    onboardingEmailMessageId: messageId,
    onboardingDeliveryUpdatedAt: occurredAt,
    onboardingDeliveryError: next.deliveryError,
    lastSyncedAt: Date.now(),
  });
  },
});

export const sendPasswordResetEmail = action({
  args: {
    user: v.object({
      id: v.string(),
      email: v.string(),
      name: v.union(v.string(), v.null()),
    }),
    url: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.emails.sendPasswordResetEmailMutation, args);
  },
});
