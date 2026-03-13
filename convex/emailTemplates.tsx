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
  Tailwind,
  Text,
} from '@react-email/components';
import { render } from '@react-email/render';
import type { ReactNode } from 'react';
import {
  type ApplicationInviteTemplateArgs,
  AVAILABLE_EMAIL_TEMPLATE_IDS,
  type ChangeEmailTemplateArgs,
  type DeleteAccountTemplateArgs,
  type InvitationTemplateArgs,
  type MagicLinkTemplateArgs,
  type ResetPasswordOtpTemplateArgs,
  type ResetPasswordTemplateArgs,
  type SignInOtpTemplateArgs,
  type StaleAccountAdminTemplateArgs,
  type StaleAccountUserTemplateArgs,
  type TwoFactorTemplateArgs,
  type VerifyEmailOtpTemplateArgs,
  type VerifyEmailTemplateArgs,
} from '../src/features/admin/lib/email-preview-registry';
import { brandTheme } from '../src/lib/shared/brand-theme';

export type { EmailTemplateId } from '../src/features/admin/lib/email-preview-registry';
export { AVAILABLE_EMAIL_TEMPLATE_IDS };

export type EmailTemplateContent = {
  subject: string;
  preview: string;
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

function getSupportEmail() {
  return (
    process.env.RESEND_REPLY_TO_EMAIL || process.env.RESEND_EMAIL_SENDER || 'support@example.com'
  );
}

function getEmailAppName(appName: string) {
  return appName || brandTheme.appName;
}

function createGreeting(name: string | null) {
  return `Hi ${name || 'there'},`;
}

const emailTheme = brandTheme.email;

async function renderTemplate(
  component: ReactNode,
  subject: string,
  preview: string,
): Promise<EmailTemplateContent> {
  const [html, text] = await Promise.all([
    render(component),
    render(component, { plainText: true }),
  ]);

  return {
    subject,
    preview,
    html,
    text,
  };
}

function CopyBlock({ children }: { children: ReactNode }) {
  return (
    <Text className="m-0 mb-4 text-[16px] leading-7" style={{ color: emailTheme.colors.textMuted }}>
      {children}
    </Text>
  );
}

function SecureLinkBlock({ actionUrl }: { actionUrl: string }) {
  return (
    <>
      <Text
        className="m-0 mt-5 mb-2 text-[13px] leading-5"
        style={{ color: emailTheme.colors.textSubtle }}
      >
        If the button does not work, copy and paste this secure link into your browser:
      </Text>
      <Text
        className="m-0 text-[13px] leading-5"
        style={{ color: emailTheme.colors.primary, wordBreak: 'break-word' }}
      >
        <Link
          href={actionUrl}
          className="no-underline"
          style={{ color: emailTheme.colors.primary, wordBreak: 'break-word' }}
        >
          {actionUrl}
        </Link>
      </Text>
    </>
  );
}

function SecurityPanel({ expiryNotice, footnote }: { expiryNotice?: string; footnote?: string }) {
  if (!expiryNotice && !footnote) {
    return null;
  }

  return (
    <Section
      className="mt-6 px-5 py-4"
      style={{
        backgroundColor: emailTheme.colors.surfaceMuted,
        border: `1px solid ${emailTheme.colors.border}`,
        borderRadius: '12px',
      }}
    >
      {expiryNotice ? (
        <Text className="m-0 text-[13px] leading-5" style={{ color: emailTheme.colors.textMuted }}>
          <strong>Security notice:</strong> {expiryNotice}
        </Text>
      ) : null}
      {footnote ? (
        <Text
          className="m-0 text-[13px] leading-5"
          style={{
            color: emailTheme.colors.textMuted,
            marginTop: expiryNotice ? '10px' : '0',
          }}
        >
          {footnote}
        </Text>
      ) : null}
    </Section>
  );
}

function EmailLayout(props: BaseEmailProps) {
  const supportEmail = getSupportEmail();
  const appName = getEmailAppName(props.appName);

  return (
    <Html>
      <Tailwind>
        <Head />
        <Preview>{props.preview}</Preview>
        <Body
          className="m-0 px-3 py-6 font-sans"
          style={{ backgroundColor: emailTheme.colors.background }}
        >
          <Container className="mx-auto w-full max-w-[640px]">
            <Section
              className="px-8 py-7"
              style={{
                backgroundColor: emailTheme.colors.surfaceStrong,
                borderTopLeftRadius: emailTheme.radius.lg,
                borderTopRightRadius: emailTheme.radius.lg,
              }}
            >
              <Text
                className="m-0 mb-2 text-[12px] leading-[18px] font-semibold tracking-[0.12em] uppercase"
                style={{ color: emailTheme.colors.primarySubtle }}
              >
                Transactional email
              </Text>
              <Heading
                className="m-0 text-[28px] leading-[34px] font-bold"
                style={{ color: emailTheme.colors.primaryForeground }}
              >
                {appName}
              </Heading>
              <Text
                className="m-0 mt-3 text-[15px] leading-6"
                style={{ color: emailTheme.colors.primaryMuted }}
              >
                {props.preview}
              </Text>
            </Section>

            <Section
              className="px-8 py-8"
              style={{
                backgroundColor: emailTheme.colors.surface,
                borderBottomLeftRadius: emailTheme.radius.lg,
                borderBottomRightRadius: emailTheme.radius.lg,
                boxShadow: emailTheme.shadow.card,
              }}
            >
              {props.children}

              <Hr className="my-8" style={{ borderColor: emailTheme.colors.border }} />
              <Text
                className="m-0 mb-2 text-[12px] leading-[18px]"
                style={{ color: emailTheme.colors.textSubtle }}
              >
                Need help?{' '}
                <Link href={`mailto:${supportEmail}`} style={{ color: emailTheme.colors.primary }}>
                  {supportEmail}
                </Link>
                .
              </Text>
              <Text
                className="m-0 text-[12px] leading-[18px]"
                style={{ color: emailTheme.colors.textQuiet }}
              >
                This transactional email was sent by {appName}. © {new Date().getFullYear()}{' '}
                {appName}.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

function ActionEmailTemplate(props: ActionEmailTemplateArgs) {
  return (
    <EmailLayout appName={props.appName} preview={props.preview}>
      <Heading
        className="m-0 mb-2 text-[24px] leading-8 font-bold"
        style={{ color: emailTheme.colors.text }}
      >
        {props.title}
      </Heading>
      <CopyBlock>{props.greeting}</CopyBlock>
      {props.paragraphs.map((paragraph) => (
        <CopyBlock key={paragraph}>{paragraph}</CopyBlock>
      ))}

      <Section className="mt-7">
        <Button
          href={props.actionUrl}
          className="inline-block px-6 py-3.5 text-[15px] leading-5 font-bold no-underline"
          style={{
            backgroundColor:
              props.ctaTone === 'danger' ? emailTheme.colors.danger : emailTheme.colors.primary,
            borderRadius: emailTheme.radius.md,
            color: emailTheme.colors.primaryForeground,
          }}
        >
          {props.actionLabel}
        </Button>
      </Section>

      <SecureLinkBlock actionUrl={props.actionUrl} />
      <SecurityPanel expiryNotice={props.expiryNotice} footnote={props.footnote} />
    </EmailLayout>
  );
}

function CodeEmailTemplate(props: CodeEmailTemplateArgs) {
  return (
    <EmailLayout appName={props.appName} preview={props.preview}>
      <Heading
        className="m-0 mb-2 text-[24px] leading-8 font-bold"
        style={{ color: emailTheme.colors.text }}
      >
        {props.title}
      </Heading>
      <CopyBlock>{props.greeting}</CopyBlock>
      {props.paragraphs.map((paragraph) => (
        <CopyBlock key={paragraph}>{paragraph}</CopyBlock>
      ))}

      <Section
        className="mt-7 px-6 py-5 text-center"
        style={{
          backgroundColor: emailTheme.colors.surfaceMuted,
          border: `1px solid ${emailTheme.colors.border}`,
          borderRadius: '14px',
        }}
      >
        <Text
          className="m-0 mb-2 text-[12px] leading-[18px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: emailTheme.colors.textSubtle }}
        >
          {props.codeLabel}
        </Text>
        <Text
          className="m-0 text-[32px] leading-9 font-bold"
          style={{ color: emailTheme.colors.text, letterSpacing: '0.18em' }}
        >
          {props.code}
        </Text>
      </Section>

      <SecurityPanel expiryNotice={props.expiryNotice} footnote={props.footnote} />
    </EmailLayout>
  );
}

function NoticeEmailTemplate(props: NoticeEmailTemplateArgs) {
  return (
    <EmailLayout appName={props.appName} preview={props.preview}>
      <Heading
        className="m-0 mb-2 text-[24px] leading-8 font-bold"
        style={{ color: emailTheme.colors.text }}
      >
        {props.title}
      </Heading>
      <CopyBlock>{props.greeting}</CopyBlock>
      {props.paragraphs.map((paragraph) => (
        <CopyBlock key={paragraph}>{paragraph}</CopyBlock>
      ))}

      {props.actionLabel && props.actionUrl ? (
        <>
          <Section className="mt-7">
            <Button
              href={props.actionUrl}
              className="inline-block px-6 py-3.5 text-[15px] leading-5 font-bold no-underline"
              style={{
                backgroundColor: emailTheme.colors.primary,
                borderRadius: emailTheme.radius.md,
                color: emailTheme.colors.primaryForeground,
              }}
            >
              {props.actionLabel}
            </Button>
          </Section>
          <SecureLinkBlock actionUrl={props.actionUrl} />
        </>
      ) : null}

      <SecurityPanel footnote={props.footnote} />
    </EmailLayout>
  );
}

export async function buildVerifyEmailTemplate(args: VerifyEmailTemplateArgs) {
  const subject = `Verify your ${args.appName} email`;
  const preview = 'Confirm your email address';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildResetPasswordTemplate(args: ResetPasswordTemplateArgs) {
  const subject = `Reset your ${args.appName} password`;
  const preview = 'Reset your password';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildChangeEmailTemplate(args: ChangeEmailTemplateArgs) {
  const subject = `Confirm your new ${args.appName} email`;
  const preview = 'Approve your email change';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildSignInOtpTemplate(args: SignInOtpTemplateArgs) {
  const subject = `Your ${args.appName} sign-in code`;
  const preview = 'Use this code to sign in';

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildVerifyEmailOtpTemplate(args: VerifyEmailOtpTemplateArgs) {
  const subject = `Verify your ${args.appName} email`;
  const preview = 'Use this code to verify your email';

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildResetPasswordOtpTemplate(args: ResetPasswordOtpTemplateArgs) {
  const subject = `Reset your ${args.appName} password`;
  const preview = 'Use this code to reset your password';

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildMagicLinkTemplate(args: MagicLinkTemplateArgs) {
  const subject = `Sign in to ${args.appName}`;
  const preview = 'Use your magic link to sign in';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildTwoFactorTemplate(args: TwoFactorTemplateArgs) {
  const subject = `Your ${args.appName} two-factor code`;
  const preview = 'Use this code to complete sign in';

  return await renderTemplate(
    <CodeEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildInvitationTemplate(args: InvitationTemplateArgs) {
  const subject = `${args.inviterName} invited you to join ${args.organizationName}`;
  const preview = 'Accept your invitation';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildApplicationInviteTemplate(args: ApplicationInviteTemplateArgs) {
  const roleDescription = args.role ? ` as ${args.role}` : '';
  const subject = `${args.inviterName} invited you to ${args.applicationName}`;
  const preview = 'Join the application';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildDeleteAccountTemplate(args: DeleteAccountTemplateArgs) {
  const subject = `Delete your ${args.appName} account`;
  const preview = 'Confirm your account deletion';

  return await renderTemplate(
    <ActionEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildStaleAccountUserTemplate(args: StaleAccountUserTemplateArgs) {
  const subject = `${args.appName} account inactivity notice`;
  const preview = 'Review your account status';

  return await renderTemplate(
    <NoticeEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}

export async function buildStaleAccountAdminTemplate(args: StaleAccountAdminTemplateArgs) {
  const subject = `${args.appName} stale account review`;
  const preview = 'An account needs review';

  return await renderTemplate(
    <NoticeEmailTemplate
      appName={args.appName}
      title={subject}
      preview={preview}
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
    preview,
  );
}
