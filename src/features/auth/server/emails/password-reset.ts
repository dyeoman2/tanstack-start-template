import {
  createBaseHtmlTemplate,
  createBaseTextTemplate,
  sendEmail,
} from '~/lib/server/email/resend.server';
import { getEnv } from '~/lib/server/env.server';

// Send password reset email
export const sendResetPasswordEmail = async (params: {
  user: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    email: string;
    emailVerified: boolean;
    name: string;
    image?: string | null;
  };
  url: string;
  token: string;
}) => {
  const env = getEnv();
  const { resetLink, userName } = { resetLink: params.url, userName: params.user.name };
  const name = userName || 'there';

  const htmlContent = `
    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="color: #1f2937; margin: 0 0 15px 0; font-size: 20px;">Reset your password</h2>
      <p style="margin: 0 0 15px 0; color: #4b5563;">Hi ${name},</p>
      <p style="margin: 0 0 20px 0; color: #4b5563;">
        We received a request to reset your password for your ${env.APP_NAME} account.
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

We received a request to reset your password for your ${env.APP_NAME} account.
If you didn't make this request, you can safely ignore this email.

To reset your password, please visit: ${resetLink}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email.
  `;

  const emailData = {
    to: params.user.email,
    from: `${env.APP_NAME} <${env.RESEND_EMAIL_SENDER}>`,
    subject: `Reset your ${env.APP_NAME} password`,
    html: createBaseHtmlTemplate(htmlContent, 'Reset your password', env.APP_NAME),
    text: createBaseTextTemplate(textContent, env.APP_NAME),
  };

  await sendEmail(emailData);
};
