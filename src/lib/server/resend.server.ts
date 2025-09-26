import { Resend } from 'resend';
import { getEnv } from '~/lib/server/env.server';

export interface EmailData {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

// Email sending functions - cached singleton
let resendClient: Resend | null = null;

const getResendClient = (): Resend => {
  if (!resendClient) {
    const env = getEnv();
    resendClient = new Resend(env.RESEND_API_KEY);
  }

  return resendClient;
};

export const sendEmail = async (
  emailData: EmailData,
): Promise<{ success: boolean; emailId?: string }> => {
  const resend = getResendClient();

  try {
    const result = await resend.emails.send({
      from: emailData.from,
      to: emailData.to,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
    });

    if (result.error) {
      console.error('Email send error:', result.error);
      throw new Error('Failed to send email');
    }

    console.log(`Email sent successfully to ${emailData.to}, Resend ID: ${result.data?.id}`);
    return { success: true, emailId: result.data?.id };
  } catch (error) {
    console.error('Email error:', error);
    throw error;
  }
};

// Base template functions
export const createBaseHtmlTemplate = (content: string, title: string, businessName: string) => `
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

export const createBaseTextTemplate = (content: string, businessName: string) => `
${businessName} - Get Started

${content}

© ${new Date().getFullYear()} ${businessName}. All rights reserved.
`;
