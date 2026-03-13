import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import type { CSSProperties, ReactNode } from 'react';

export const AVAILABLE_EMAIL_TEMPLATE_IDS = [
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
] as const;

export type EmailTemplateId = (typeof AVAILABLE_EMAIL_TEMPLATE_IDS)[number];

export type EmailTemplateContent = {
  subject: string;
  html: string;
  text: string;
};

type ActionEmailTemplateArgs = {
  appName: string;
  title: string;
  preview: string;
  greeting: string;
  paragraphs: string[];
  actionLabel: string;
  actionUrl: string;
  expiryNotice?: string;
  footnote?: string;
  ctaTone?: 'primary' | 'danger';
};

type CodeEmailTemplateArgs = {
  appName: string;
  title: string;
  preview: string;
  greeting: string;
  paragraphs: string[];
  codeLabel: string;
  code: string;
  expiryNotice?: string;
  footnote?: string;
};

type NoticeEmailTemplateArgs = {
  appName: string;
  title: string;
  preview: string;
  greeting: string;
  paragraphs: string[];
  actionLabel?: string;
  actionUrl?: string;
  footnote?: string;
};

type BaseEmailProps = {
  appName: string;
  preview: string;
  children: ReactNode;
};

const colors = {
  background: '#f3f6fb',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  border: '#e5e7eb',
  borderStrong: '#dbe4f0',
  text: '#111827',
  textMuted: '#4b5563',
  textSubtle: '#6b7280',
  textQuiet: '#9ca3af',
  brand: '#2563eb',
  brandDark: '#0f172a',
  danger: '#dc2626',
  white: '#ffffff',
} as const;

const bodyStyle: CSSProperties = {
  backgroundColor: colors.background,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: '24px 12px',
};

const outerContainerStyle: CSSProperties = {
  margin: '0 auto',
  maxWidth: '640px',
  width: '100%',
};

const heroStyle: CSSProperties = {
  background: `linear-gradient(135deg, ${colors.brandDark} 0%, ${colors.brand} 100%)`,
  borderRadius: '18px 18px 0 0',
  padding: '28px 32px 20px',
};

const heroLabelStyle: CSSProperties = {
  color: '#bfdbfe',
  fontSize: '12px',
  letterSpacing: '0.08em',
  lineHeight: '18px',
  margin: '0 0 8px',
  textTransform: 'uppercase',
};

const heroTitleStyle: CSSProperties = {
  color: colors.white,
  fontSize: '28px',
  fontWeight: 700,
  lineHeight: '34px',
  margin: 0,
};

const heroPreviewStyle: CSSProperties = {
  color: '#dbeafe',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '10px 0 0',
};

const cardStyle: CSSProperties = {
  backgroundColor: colors.surface,
  borderRadius: '0 0 18px 18px',
  boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)',
  padding: '32px',
};

const titleStyle: CSSProperties = {
  color: colors.text,
  fontSize: '24px',
  fontWeight: 700,
  lineHeight: '30px',
  margin: '0 0 8px',
};

const textStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
};

const primaryButtonStyle: CSSProperties = {
  backgroundColor: colors.brand,
  borderRadius: '10px',
  color: colors.white,
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 700,
  lineHeight: '20px',
  padding: '14px 24px',
  textDecoration: 'none',
};

const dangerButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: colors.danger,
};

const supportBoxStyle: CSSProperties = {
  backgroundColor: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: '12px',
  marginTop: '24px',
  padding: '16px 18px',
};

const codeBoxStyle: CSSProperties = {
  backgroundColor: colors.surfaceMuted,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: '14px',
  marginTop: '28px',
  padding: '18px 22px',
  textAlign: 'center',
};

const codeLabelStyle: CSSProperties = {
  color: colors.textSubtle,
  fontSize: '12px',
  letterSpacing: '0.08em',
  lineHeight: '18px',
  margin: '0 0 8px',
  textTransform: 'uppercase',
};

const codeValueStyle: CSSProperties = {
  color: colors.text,
  fontSize: '32px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  lineHeight: '36px',
  margin: 0,
};

const linkTextStyle: CSSProperties = {
  color: colors.brand,
  fontSize: '13px',
  lineHeight: '20px',
  margin: 0,
  wordBreak: 'break-word',
};

const footerTextStyle: CSSProperties = {
  color: colors.textSubtle,
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0 0 8px',
};

function getSupportEmail() {
  return (
    process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_EMAIL_SENDER || 'support@example.com'
  );
}

function createGreeting(name: string | null) {
  return `Hi ${name || 'there'},`;
}

async function renderTemplate(
  component: ReactNode,
  subject: string,
): Promise<EmailTemplateContent> {
  const [html, text] = await Promise.all([
    render(component),
    render(component, { plainText: true }),
  ]);

  return {
    subject,
    html,
    text,
  };
}

function BaseEmail(props: BaseEmailProps) {
  const supportEmail = getSupportEmail();

  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={outerContainerStyle}>
          <Section style={heroStyle}>
            <Text style={heroLabelStyle}>Transactional email</Text>
            <Heading style={heroTitleStyle}>{props.appName}</Heading>
            <Text style={heroPreviewStyle}>{props.preview}</Text>
          </Section>

          <Section style={cardStyle}>
            {props.children}
            <Hr style={{ borderColor: colors.border, margin: '32px 0 20px' }} />
            <Text style={footerTextStyle}>
              Need help?{' '}
              <Link href={`mailto:${supportEmail}`} style={{ color: colors.brand }}>
                {supportEmail}
              </Link>
              .
            </Text>
            <Text style={{ ...footerTextStyle, color: colors.textQuiet, marginBottom: 0 }}>
              This transactional email was sent by {props.appName}. © {new Date().getFullYear()}{' '}
              {props.appName}.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function ActionEmailTemplate(props: ActionEmailTemplateArgs) {
  const buttonStyle = props.ctaTone === 'danger' ? dangerButtonStyle : primaryButtonStyle;

  return (
    <BaseEmail appName={props.appName} preview={props.preview}>
      <Heading style={titleStyle}>{props.title}</Heading>
      <Text style={textStyle}>{props.greeting}</Text>
      {props.paragraphs.map((paragraph) => (
        <Text key={paragraph} style={textStyle}>
          {paragraph}
        </Text>
      ))}

      <Section style={{ marginTop: '28px', textAlign: 'left' }}>
        <Button href={props.actionUrl} style={buttonStyle}>
          {props.actionLabel}
        </Button>
      </Section>

      <Text
        style={{
          ...textStyle,
          color: colors.textSubtle,
          fontSize: '13px',
          lineHeight: '20px',
          marginTop: '16px',
          marginBottom: '8px',
        }}
      >
        If the button does not work, copy and paste this secure link into your browser:
      </Text>
      <Text style={linkTextStyle}>
        <Link href={props.actionUrl} style={{ color: colors.brand, textDecoration: 'none' }}>
          {props.actionUrl}
        </Link>
      </Text>

      {(props.expiryNotice || props.footnote) && (
        <Section style={supportBoxStyle}>
          {props.expiryNotice ? (
            <Text
              style={{
                ...textStyle,
                fontSize: '13px',
                lineHeight: '20px',
                marginBottom: props.footnote ? '10px' : 0,
              }}
            >
              <strong>Security notice:</strong> {props.expiryNotice}
            </Text>
          ) : null}
          {props.footnote ? (
            <Text style={{ ...textStyle, fontSize: '13px', lineHeight: '20px', marginBottom: 0 }}>
              {props.footnote}
            </Text>
          ) : null}
        </Section>
      )}
    </BaseEmail>
  );
}

function CodeEmailTemplate(props: CodeEmailTemplateArgs) {
  return (
    <BaseEmail appName={props.appName} preview={props.preview}>
      <Heading style={titleStyle}>{props.title}</Heading>
      <Text style={textStyle}>{props.greeting}</Text>
      {props.paragraphs.map((paragraph) => (
        <Text key={paragraph} style={textStyle}>
          {paragraph}
        </Text>
      ))}

      <Section style={codeBoxStyle}>
        <Text style={codeLabelStyle}>{props.codeLabel}</Text>
        <Text style={codeValueStyle}>{props.code}</Text>
      </Section>

      {(props.expiryNotice || props.footnote) && (
        <Section style={supportBoxStyle}>
          {props.expiryNotice ? (
            <Text
              style={{
                ...textStyle,
                fontSize: '13px',
                lineHeight: '20px',
                marginBottom: props.footnote ? '10px' : 0,
              }}
            >
              <strong>Security notice:</strong> {props.expiryNotice}
            </Text>
          ) : null}
          {props.footnote ? (
            <Text style={{ ...textStyle, fontSize: '13px', lineHeight: '20px', marginBottom: 0 }}>
              {props.footnote}
            </Text>
          ) : null}
        </Section>
      )}
    </BaseEmail>
  );
}

function NoticeEmailTemplate(props: NoticeEmailTemplateArgs) {
  return (
    <BaseEmail appName={props.appName} preview={props.preview}>
      <Heading style={titleStyle}>{props.title}</Heading>
      <Text style={textStyle}>{props.greeting}</Text>
      {props.paragraphs.map((paragraph) => (
        <Text key={paragraph} style={textStyle}>
          {paragraph}
        </Text>
      ))}

      {props.actionLabel && props.actionUrl ? (
        <>
          <Section style={{ marginTop: '28px', textAlign: 'left' }}>
            <Button href={props.actionUrl} style={primaryButtonStyle}>
              {props.actionLabel}
            </Button>
          </Section>
          <Text
            style={{
              ...textStyle,
              color: colors.textSubtle,
              fontSize: '13px',
              lineHeight: '20px',
              marginTop: '16px',
              marginBottom: '8px',
            }}
          >
            If the button does not work, copy and paste this secure link into your browser:
          </Text>
          <Text style={linkTextStyle}>
            <Link href={props.actionUrl} style={{ color: colors.brand, textDecoration: 'none' }}>
              {props.actionUrl}
            </Link>
          </Text>
        </>
      ) : null}

      {props.footnote ? (
        <Section style={supportBoxStyle}>
          <Text style={{ ...textStyle, fontSize: '13px', lineHeight: '20px', marginBottom: 0 }}>
            {props.footnote}
          </Text>
        </Section>
      ) : null}
    </BaseEmail>
  );
}

export async function buildVerifyEmailTemplate(args: {
  appName: string;
  userName: string | null;
  verificationLink: string;
}) {
  const subject = `Verify your ${args.appName} email`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Confirm your email address"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `Please confirm the email address for your ${args.appName} account.`,
        "If you didn't create this account, you can ignore this email.",
      ]}
      actionLabel="Verify Email"
      actionUrl={args.verificationLink}
      expiryNotice="This verification link may expire for security reasons."
    />,
    subject,
  );
}

export async function buildResetPasswordTemplate(args: {
  appName: string;
  userName: string | null;
  resetLink: string;
  expiryNotice?: string;
}) {
  const subject = `Reset your ${args.appName} password`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Reset your password"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `We received a request to reset the password for your ${args.appName} account.`,
        "If you didn't make this request, you can safely ignore this email.",
      ]}
      actionLabel="Reset Password"
      actionUrl={args.resetLink}
      expiryNotice={args.expiryNotice ?? 'This password reset link will expire in 1 hour.'}
      footnote="If you didn't request a password reset, no further action is required."
    />,
    subject,
  );
}

export async function buildChangeEmailTemplate(args: {
  appName: string;
  userName: string | null;
  newEmail: string;
  verificationLink: string;
}) {
  const subject = `Confirm your new ${args.appName} email`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Approve your email change"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `We received a request to change the email on your ${args.appName} account to ${args.newEmail}.`,
        'Use the secure confirmation link below to approve the change.',
        'If you did not request this update, do not click the link and contact support immediately.',
      ]}
      actionLabel="Confirm Email Change"
      actionUrl={args.verificationLink}
      expiryNotice="This email change confirmation link may expire for security reasons."
    />,
    subject,
  );
}

export async function buildSignInOtpTemplate(args: {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
}) {
  const subject = `Your ${args.appName} sign-in code`;

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Use this code to sign in"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `Enter this code to sign in to ${args.appName}.`,
        'Never share this code with anyone, including support.',
      ]}
      codeLabel="Sign-in code"
      code={args.otp}
      expiryNotice={args.expiryNotice ?? 'This sign-in code may expire shortly.'}
    />,
    subject,
  );
}

export async function buildVerifyEmailOtpTemplate(args: {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
}) {
  const subject = `Verify your ${args.appName} email`;

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Use this code to verify your email"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `Enter this code to verify the email address on your ${args.appName} account.`,
        'If you did not request verification, you can ignore this email.',
      ]}
      codeLabel="Verification code"
      code={args.otp}
      expiryNotice={args.expiryNotice ?? 'This verification code may expire shortly.'}
    />,
    subject,
  );
}

export async function buildResetPasswordOtpTemplate(args: {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
}) {
  const subject = `Reset your ${args.appName} password`;

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Use this code to reset your password"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `Enter this code to reset the password for your ${args.appName} account.`,
        'If you did not request a password reset, do not use this code.',
      ]}
      codeLabel="Reset code"
      code={args.otp}
      expiryNotice={args.expiryNotice ?? 'This reset code may expire shortly.'}
    />,
    subject,
  );
}

export async function buildMagicLinkTemplate(args: {
  appName: string;
  userName: string | null;
  magicLink: string;
  expiryNotice?: string;
}) {
  const subject = `Sign in to ${args.appName}`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Use your magic link to sign in"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `Use the secure sign-in link below to access your ${args.appName} account.`,
        'If you did not request this link, you can ignore this email.',
      ]}
      actionLabel="Sign In"
      actionUrl={args.magicLink}
      expiryNotice={args.expiryNotice ?? 'This sign-in link may expire shortly.'}
    />,
    subject,
  );
}

export async function buildTwoFactorTemplate(args: {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
}) {
  const subject = `Your ${args.appName} two-factor code`;

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Use this code to complete sign in"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `Enter this code to complete two-factor authentication for ${args.appName}.`,
        'Never share this code with anyone, including support.',
      ]}
      codeLabel="Two-factor code"
      code={args.otp}
      expiryNotice={args.expiryNotice ?? 'This two-factor code may expire shortly.'}
    />,
    subject,
  );
}

export async function buildInvitationTemplate(args: {
  appName: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
}) {
  const subject = `${args.inviterName} invited you to join ${args.organizationName}`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Accept your invitation"
      greeting="Hello,"
      paragraphs={[
        `${args.inviterName} invited you to join ${args.organizationName} on ${args.appName} as ${args.role}.`,
        'Accept the invitation below to join the organization.',
      ]}
      actionLabel="Accept Invitation"
      actionUrl={args.inviteUrl}
      expiryNotice="This invitation expires in 7 days."
    />,
    subject,
  );
}

export async function buildApplicationInviteTemplate(args: {
  appName: string;
  inviterName: string;
  applicationName: string;
  role?: string;
  inviteUrl: string;
}) {
  const roleDescription = args.role ? ` as ${args.role}` : '';
  const subject = `${args.inviterName} invited you to ${args.applicationName}`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Join the application"
      greeting="Hello,"
      paragraphs={[
        `${args.inviterName} invited you to join ${args.applicationName}${roleDescription}.`,
        'Use the invitation below to get started.',
      ]}
      actionLabel="Accept Invite"
      actionUrl={args.inviteUrl}
      expiryNotice="This invitation may expire for security reasons."
    />,
    subject,
  );
}

export async function buildDeleteAccountTemplate(args: {
  appName: string;
  userName: string | null;
  deleteUrl: string;
  expiryNotice?: string;
}) {
  const subject = `Delete your ${args.appName} account`;

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Confirm your account deletion"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        `We received a request to permanently delete your ${args.appName} account.`,
        'This action cannot be undone once it is confirmed.',
        'If you did not request account deletion, do not click the link and contact support immediately.',
      ]}
      actionLabel="Delete Account"
      actionUrl={args.deleteUrl}
      expiryNotice={args.expiryNotice ?? 'This account deletion link may expire shortly.'}
      footnote="If you did not request account deletion, contact support immediately."
      ctaTone="danger"
    />,
    subject,
  );
}

export async function buildStaleAccountUserTemplate(args: {
  appName: string;
  userName: string | null;
  inactivityMessage: string;
  reviewUrl?: string;
}) {
  const subject = `${args.appName} account inactivity notice`;

  return await renderTemplate(
    <NoticeEmailTemplate
      appName={args.appName}
      title={subject}
      preview="Review your account status"
      greeting={createGreeting(args.userName)}
      paragraphs={[
        args.inactivityMessage,
        'Sign in or review your account if you want to keep it active.',
      ]}
      actionLabel={args.reviewUrl ? 'Review Account' : undefined}
      actionUrl={args.reviewUrl}
      footnote="If you no longer need this account, no action is required."
    />,
    subject,
  );
}

export async function buildStaleAccountAdminTemplate(args: {
  appName: string;
  adminName: string | null;
  affectedUserEmail: string;
  inactivityMessage: string;
  reviewUrl?: string;
}) {
  const subject = `${args.appName} stale account review`;

  return await renderTemplate(
    <NoticeEmailTemplate
      appName={args.appName}
      title={subject}
      preview="An account needs review"
      greeting={createGreeting(args.adminName)}
      paragraphs={[
        `The account for ${args.affectedUserEmail} needs review.`,
        args.inactivityMessage,
      ]}
      actionLabel={args.reviewUrl ? 'Review Account' : undefined}
      actionUrl={args.reviewUrl}
      footnote="Review the account before taking any automated cleanup action."
    />,
    subject,
  );
}
