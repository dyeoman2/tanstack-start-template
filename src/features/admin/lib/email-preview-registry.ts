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
  'support-access-granted',
  'support-access-used',
  'support-access-revoked',
  'support-access-expired',
  'stale-account-user',
  'stale-account-admin',
] as const;

export type EmailTemplateId = (typeof AVAILABLE_EMAIL_TEMPLATE_IDS)[number];

export type VerifyEmailTemplateArgs = {
  appName: string;
  userName: string | null;
  verificationLink: string;
};

export type ResetPasswordTemplateArgs = {
  appName: string;
  userName: string | null;
  resetLink: string;
  expiryNotice?: string;
};

export type ChangeEmailTemplateArgs = {
  appName: string;
  userName: string | null;
  newEmail: string;
  verificationLink: string;
};

export type SignInOtpTemplateArgs = {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
};

export type VerifyEmailOtpTemplateArgs = {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
};

export type ResetPasswordOtpTemplateArgs = {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
};

export type MagicLinkTemplateArgs = {
  appName: string;
  userName: string | null;
  magicLink: string;
  expiryNotice?: string;
};

export type TwoFactorTemplateArgs = {
  appName: string;
  userName: string | null;
  otp: string;
  expiryNotice?: string;
};

export type InvitationTemplateArgs = {
  appName: string;
  inviterName: string;
  organizationName: string;
  role: string;
  inviteUrl: string;
};

export type ApplicationInviteTemplateArgs = {
  appName: string;
  inviterName: string;
  applicationName: string;
  role?: string;
  inviteUrl: string;
};

export type DeleteAccountTemplateArgs = {
  appName: string;
  userName: string | null;
  deleteUrl: string;
  expiryNotice?: string;
};

export type SupportAccessLifecycleTemplateArgs = {
  appName: string;
  approvalMethod: 'single_owner';
  approverName: string | null;
  event: 'expired' | 'granted' | 'revoked' | 'used';
  expiresAt: number;
  organizationName: string;
  reasonCategory:
    | 'incident_response'
    | 'customer_requested_change'
    | 'data_repair'
    | 'account_recovery'
    | 'other';
  reasonDetails: string;
  revokeReason?: string | null;
  scope: 'read_only' | 'read_write';
  siteAdminEmail: string;
  siteAdminName: string | null;
  ticketId: string;
};

export type StaleAccountUserTemplateArgs = {
  appName: string;
  userName: string | null;
  inactivityMessage: string;
  reviewUrl?: string;
};

export type StaleAccountAdminTemplateArgs = {
  appName: string;
  adminName: string | null;
  affectedUserEmail: string;
  inactivityMessage: string;
  reviewUrl?: string;
};

export type EmailTemplateArgsById = {
  'verify-email': VerifyEmailTemplateArgs;
  'reset-password': ResetPasswordTemplateArgs;
  'change-email': ChangeEmailTemplateArgs;
  'sign-in-otp': SignInOtpTemplateArgs;
  'verify-email-otp': VerifyEmailOtpTemplateArgs;
  'reset-password-otp': ResetPasswordOtpTemplateArgs;
  'magic-link': MagicLinkTemplateArgs;
  'two-factor': TwoFactorTemplateArgs;
  invitation: InvitationTemplateArgs;
  'application-invite': ApplicationInviteTemplateArgs;
  'delete-account': DeleteAccountTemplateArgs;
  'support-access-granted': SupportAccessLifecycleTemplateArgs;
  'support-access-used': SupportAccessLifecycleTemplateArgs;
  'support-access-revoked': SupportAccessLifecycleTemplateArgs;
  'support-access-expired': SupportAccessLifecycleTemplateArgs;
  'stale-account-user': StaleAccountUserTemplateArgs;
  'stale-account-admin': StaleAccountAdminTemplateArgs;
};

export type EmailPreviewScenario<TTemplateId extends EmailTemplateId = EmailTemplateId> = {
  id: string;
  label: string;
  description: string;
  props: EmailTemplateArgsById[TTemplateId];
};

export type EmailPreviewTemplateDefinition<TTemplateId extends EmailTemplateId = EmailTemplateId> =
  {
    id: TTemplateId;
    label: string;
    description: string;
    scenarios: readonly EmailPreviewScenario<TTemplateId>[];
  };

function defineTemplate<TTemplateId extends EmailTemplateId>(
  template: EmailPreviewTemplateDefinition<TTemplateId>,
) {
  return template;
}

export const EMAIL_PREVIEW_TEMPLATES = [
  defineTemplate({
    id: 'reset-password',
    label: 'Reset Password',
    description: 'Password reset links for email and password sign-in.',
    scenarios: [
      {
        id: 'standard',
        label: 'Standard reset',
        description: 'Default password reset request for an existing account.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Casey',
          resetLink: 'https://app.acme.test/reset-password?token=reset_demo_123',
          expiryNotice: 'This password reset link will expire in 1 hour.',
        },
      },
      {
        id: 'security-review',
        label: 'Security review',
        description: 'Reset copy with no user name and a shorter expiry warning.',
        props: {
          appName: 'Acme Workspace',
          userName: null,
          resetLink: 'https://app.acme.test/reset-password?token=security_review_456',
          expiryNotice: 'This password reset link will expire in 30 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'verify-email',
    label: 'Verify Email',
    description: 'Email address confirmation for new or changed accounts.',
    scenarios: [
      {
        id: 'new-account',
        label: 'New account',
        description: 'A new user confirms the email on a fresh account.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Riley',
          verificationLink: 'https://app.acme.test/verify-email?token=verify_demo_123',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'change-email',
    label: 'Change Email',
    description: 'Secure approval for changing the primary email address.',
    scenarios: [
      {
        id: 'primary-change',
        label: 'Primary change',
        description: 'A signed-in user confirms a new email address.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Morgan',
          newEmail: 'morgan.updated@example.com',
          verificationLink: 'https://app.acme.test/change-email?token=email_change_123',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'sign-in-otp',
    label: 'Sign-In OTP',
    description: 'One-time code for passwordless or step-up sign-in.',
    scenarios: [
      {
        id: 'default-code',
        label: 'Default code',
        description: 'Standard sign-in OTP flow.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Jordan',
          otp: '214938',
          expiryNotice: 'This sign-in code will expire in 10 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'verify-email-otp',
    label: 'Verify Email OTP',
    description: 'One-time code for confirming an email address.',
    scenarios: [
      {
        id: 'code-verification',
        label: 'Code verification',
        description: 'Email verification delivered as a short-lived code.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Taylor',
          otp: '620155',
          expiryNotice: 'This verification code will expire in 10 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'reset-password-otp',
    label: 'Reset Password OTP',
    description: 'One-time code for password reset flows.',
    scenarios: [
      {
        id: 'code-reset',
        label: 'Code reset',
        description: 'Password reset delivered as a one-time code.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Harper',
          otp: '903441',
          expiryNotice: 'This reset code will expire in 10 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'magic-link',
    label: 'Magic Link',
    description: 'Single-use sign-in link sent to the user email.',
    scenarios: [
      {
        id: 'sign-in',
        label: 'Sign-in link',
        description: 'Passwordless sign-in using a single-use magic link.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Dakota',
          magicLink: 'https://app.acme.test/magic-link?token=magic_demo_123',
          expiryNotice: 'This sign-in link will expire in 15 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'two-factor',
    label: 'Two-Factor',
    description: 'Secondary factor code during sign-in.',
    scenarios: [
      {
        id: 'step-up',
        label: 'Step-up auth',
        description: 'A two-factor challenge after password sign-in.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Skyler',
          otp: '118275',
          expiryNotice: 'This two-factor code will expire in 5 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'invitation',
    label: 'Organization Invitation',
    description: 'Invitation to join an organization or workspace.',
    scenarios: [
      {
        id: 'admin-invite',
        label: 'Admin invite',
        description: 'An administrator invites a user into an organization.',
        props: {
          appName: 'Acme Workspace',
          inviterName: 'Pat Lee',
          organizationName: 'Operations',
          role: 'admin',
          inviteUrl: 'https://app.acme.test/invitations/org_ops_admin_123',
        },
      },
      {
        id: 'member-invite',
        label: 'Member invite',
        description: 'A standard member invitation into an organization workspace.',
        props: {
          appName: 'Acme Workspace',
          inviterName: 'Sam Ortiz',
          organizationName: 'Success',
          role: 'member',
          inviteUrl: 'https://app.acme.test/invitations/org_success_member_456',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'application-invite',
    label: 'Application Invite',
    description: 'Invitation into an application-level experience.',
    scenarios: [
      {
        id: 'workspace-access',
        label: 'Workspace access',
        description: 'A user is invited into an application with a named role.',
        props: {
          appName: 'Acme Workspace',
          inviterName: 'Alex Kim',
          applicationName: 'Acme Insights',
          role: 'editor',
          inviteUrl: 'https://app.acme.test/invitations/app_editor_123',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'delete-account',
    label: 'Delete Account',
    description: 'High-risk deletion confirmation for a user account.',
    scenarios: [
      {
        id: 'destructive-confirmation',
        label: 'Destructive confirmation',
        description: 'A user confirms permanent deletion of the account.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Quinn',
          deleteUrl: 'https://app.acme.test/delete-account?token=delete_account_123',
          expiryNotice: 'This account deletion link will expire in 30 minutes.',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'support-access-granted',
    label: 'Support Access Granted',
    description: 'Owner-approved provider support access notification.',
    scenarios: [
      {
        id: 'single-owner-approval',
        label: 'Single owner approval',
        description: 'A temporary provider support grant has been approved.',
        props: {
          appName: 'Acme Workspace',
          approvalMethod: 'single_owner',
          approverName: 'Morgan',
          event: 'granted',
          expiresAt: Date.now() + 60 * 60 * 1000,
          organizationName: 'Cottage Hospital',
          reasonCategory: 'incident_response',
          reasonDetails: 'Investigate a regulated document ingestion issue tied to INC-42.',
          revokeReason: null,
          scope: 'read_write',
          siteAdminEmail: 'support@example.com',
          siteAdminName: 'Support Admin',
          ticketId: 'INC-42',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'support-access-used',
    label: 'Support Access Used',
    description: 'Notification that provider support has started using an approved grant.',
    scenarios: [
      {
        id: 'first-use',
        label: 'First use',
        description: 'Provider support exercised the temporary access grant.',
        props: {
          appName: 'Acme Workspace',
          approvalMethod: 'single_owner',
          approverName: 'Morgan',
          event: 'used',
          expiresAt: Date.now() + 45 * 60 * 1000,
          organizationName: 'Cottage Hospital',
          reasonCategory: 'data_repair',
          reasonDetails: 'Validate data repair steps requested by the customer.',
          revokeReason: null,
          scope: 'read_only',
          siteAdminEmail: 'support@example.com',
          siteAdminName: 'Support Admin',
          ticketId: 'INC-77',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'support-access-revoked',
    label: 'Support Access Revoked',
    description: 'Notification that a temporary support grant was manually revoked.',
    scenarios: [
      {
        id: 'manual-revoke',
        label: 'Manual revoke',
        description: 'The owner revoked provider support access before expiry.',
        props: {
          appName: 'Acme Workspace',
          approvalMethod: 'single_owner',
          approverName: 'Morgan',
          event: 'revoked',
          expiresAt: Date.now() + 30 * 60 * 1000,
          organizationName: 'Cottage Hospital',
          reasonCategory: 'customer_requested_change',
          reasonDetails: 'Carry out a customer-requested configuration change.',
          revokeReason: 'Issue resolved; support no longer needs write access.',
          scope: 'read_write',
          siteAdminEmail: 'support@example.com',
          siteAdminName: 'Support Admin',
          ticketId: 'CHG-9',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'support-access-expired',
    label: 'Support Access Expired',
    description: 'Notification that a temporary support grant expired automatically.',
    scenarios: [
      {
        id: 'automatic-expiry',
        label: 'Automatic expiry',
        description: 'The temporary provider support grant expired without manual revocation.',
        props: {
          appName: 'Acme Workspace',
          approvalMethod: 'single_owner',
          approverName: 'Morgan',
          event: 'expired',
          expiresAt: Date.now() - 5 * 60 * 1000,
          organizationName: 'Cottage Hospital',
          reasonCategory: 'account_recovery',
          reasonDetails: 'Review account recovery artifacts for a locked-out user.',
          revokeReason: null,
          scope: 'read_only',
          siteAdminEmail: 'support@example.com',
          siteAdminName: 'Support Admin',
          ticketId: 'ACC-88',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'stale-account-user',
    label: 'Stale Account User',
    description: 'Notice sent directly to a user about inactivity.',
    scenarios: [
      {
        id: 'reactivation-reminder',
        label: 'Reactivation reminder',
        description: 'A user is reminded to sign back in before cleanup.',
        props: {
          appName: 'Acme Workspace',
          userName: 'Jamie',
          inactivityMessage:
            'Your account has been inactive for 90 days and is scheduled for archival soon.',
          reviewUrl: 'https://app.acme.test/settings/account',
        },
      },
    ],
  }),
  defineTemplate({
    id: 'stale-account-admin',
    label: 'Stale Account Admin',
    description: 'Notice sent to admins before stale-account cleanup.',
    scenarios: [
      {
        id: 'admin-review',
        label: 'Admin review',
        description: 'An admin reviews an account before automated cleanup.',
        props: {
          appName: 'Acme Workspace',
          adminName: 'Robin',
          affectedUserEmail: 'inactive.user@example.com',
          inactivityMessage:
            'This account has been inactive for 120 days and is queued for admin review.',
          reviewUrl: 'https://app.acme.test/admin/users/inactive-user',
        },
      },
    ],
  }),
] as const satisfies readonly EmailPreviewTemplateDefinition[];

export const DEFAULT_EMAIL_PREVIEW_TEMPLATE_ID = EMAIL_PREVIEW_TEMPLATES[0].id;
export const DEFAULT_EMAIL_PREVIEW_SCENARIO_ID = EMAIL_PREVIEW_TEMPLATES[0].scenarios[0].id;

export type EmailPreviewSelection = {
  template: EmailTemplateId;
  scenario: string;
};

export function isEmailTemplateId(value: string): value is EmailTemplateId {
  return AVAILABLE_EMAIL_TEMPLATE_IDS.includes(value as EmailTemplateId);
}

export function getEmailPreviewTemplate(
  templateId: EmailTemplateId,
): EmailPreviewTemplateDefinition | null {
  return EMAIL_PREVIEW_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

export function getEmailPreviewScenario(
  templateId: EmailTemplateId,
  scenarioId: string,
): EmailPreviewScenario | null {
  const template = getEmailPreviewTemplate(templateId);
  if (!template) {
    return null;
  }

  const scenario = template.scenarios.find((candidate) => candidate.id === scenarioId);

  return scenario ?? null;
}

export function resolveEmailPreviewSelection(args: {
  template?: string | null;
  scenario?: string | null;
}): EmailPreviewSelection {
  const template =
    args.template && isEmailTemplateId(args.template)
      ? getEmailPreviewTemplate(args.template)
      : EMAIL_PREVIEW_TEMPLATES[0];

  if (!template) {
    return {
      template: DEFAULT_EMAIL_PREVIEW_TEMPLATE_ID,
      scenario: DEFAULT_EMAIL_PREVIEW_SCENARIO_ID,
    };
  }

  const scenario =
    args.scenario && args.scenario.length > 0
      ? template.scenarios.find((candidate) => candidate.id === args.scenario)
      : null;

  return {
    template: template.id,
    scenario: scenario?.id ?? template.scenarios[0].id,
  };
}
