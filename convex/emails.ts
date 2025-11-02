import { Resend } from '@convex-dev/resend';
import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { action, internalMutation, query } from './_generated/server';

/**
 * Email utilities for Convex using the official @convex-dev/resend component
 * Provides queueing, batching, durable execution, and rate limiting
 */

// Initialize Resend component instance
export const resend: Resend = new Resend(components.resend, {
  testMode: false, // Set to true during development to only allow test emails
});

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

// Base template functions
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

/**
 * Internal mutation that sends password reset email using the Resend component
 * Can only be called from within Convex (actions/mutations)
 */
export const sendPasswordResetEmailMutation = internalMutation({
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
    const appName = process.env.APP_NAME || 'Hackathon';
    const emailSender = process.env.RESEND_EMAIL_SENDER || 'onboarding@resend.dev';
    const resetLink = args.url;
    const userName = args.user.name;
    const name = userName || 'there';

    const htmlContent = `
    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="color: #1f2937; margin: 0 0 15px 0; font-size: 20px;">Reset your password</h2>
      <p style="margin: 0 0 15px 0; color: #4b5563;">Hi ${name},</p>
      <p style="margin: 0 0 20px 0; color: #4b5563;">
        We received a request to reset your password for your ${appName} account.
        If you didn't make this request, you can safely ignore this email.
      </p>
      <p style="margin: 0 0 25px 0; color: #4b5563;">
        Click the button below to reset your password. This link will expire in 1 hour for security reasons.
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}"
           style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">
          Reset Password
        </a>
      </div>

      <p style="margin: 25px 0 15px 0; color: #6b7280; font-size: 14px;">
        If the button doesn't work, you can copy and paste this link into your browser:
      </p>
      <p style="margin: 0; color: #2563eb; word-break: break-all; font-size: 14px;">
        ${resetLink}
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

We received a request to reset your password for your ${appName} account.
If you didn't make this request, you can safely ignore this email.

To reset your password, please visit: ${resetLink}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email.
  `;

    // Use the official Resend component for reliable email delivery
    await resend.sendEmail(ctx, {
      from: `${appName} <${emailSender}>`,
      to: args.user.email,
      subject: `Reset your ${appName} password`,
      html: createBaseHtmlTemplate(htmlContent, 'Reset your password', appName),
      text: createBaseTextTemplate(textContent, appName),
    });
  },
});

/**
 * Action wrapper that schedules the email mutation
 * Can be called from Better Auth callbacks or external code
 */
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
    // Schedule the mutation immediately (0ms delay)
    // The Resend component will handle queueing and delivery
    await ctx.scheduler.runAfter(0, internal.emails.sendPasswordResetEmailMutation, args);
  },
});
