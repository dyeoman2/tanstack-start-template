import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  AVAILABLE_EMAIL_TEMPLATE_IDS,
  EMAIL_PREVIEW_TEMPLATES,
  type EmailPreviewTemplateDefinition,
  type EmailTemplateId,
} from '~/features/admin/lib/email-preview-registry';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { handleServerError, ServerError } from '~/lib/server/error-utils.server';
import {
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
} from '../../../../convex/emailTemplates';

export const emailPreviewRequestSchema = z.object({
  template: z.enum(AVAILABLE_EMAIL_TEMPLATE_IDS),
  scenario: z.string().min(1),
});

export type EmailPreviewRequest = z.infer<typeof emailPreviewRequestSchema>;

export type EmailPreviewResponse = {
  subject: string;
  preview: string;
  html: string;
  text: string;
};

function getScenarioOrThrow<TTemplateId extends EmailTemplateId>(
  template: EmailPreviewTemplateDefinition<TTemplateId> | undefined,
  scenarioId: string,
) {
  const scenario = template?.scenarios.find((candidate) => candidate.id === scenarioId);

  if (!scenario) {
    throw new ServerError('Unknown email preview scenario', 400);
  }

  return scenario;
}

export async function renderEmailPreview(args: EmailPreviewRequest): Promise<EmailPreviewResponse> {
  switch (args.template) {
    case 'verify-email': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'verify-email'> =>
          candidate.id === 'verify-email',
      );
      return await buildVerifyEmailTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'reset-password': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'reset-password'> =>
          candidate.id === 'reset-password',
      );
      return await buildResetPasswordTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'change-email': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'change-email'> =>
          candidate.id === 'change-email',
      );
      return await buildChangeEmailTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'sign-in-otp': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'sign-in-otp'> =>
          candidate.id === 'sign-in-otp',
      );
      return await buildSignInOtpTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'verify-email-otp': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'verify-email-otp'> =>
          candidate.id === 'verify-email-otp',
      );
      return await buildVerifyEmailOtpTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'reset-password-otp': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'reset-password-otp'> =>
          candidate.id === 'reset-password-otp',
      );
      return await buildResetPasswordOtpTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'magic-link': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'magic-link'> =>
          candidate.id === 'magic-link',
      );
      return await buildMagicLinkTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'two-factor': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'two-factor'> =>
          candidate.id === 'two-factor',
      );
      return await buildTwoFactorTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'invitation': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'invitation'> =>
          candidate.id === 'invitation',
      );
      return await buildInvitationTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'application-invite': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'application-invite'> =>
          candidate.id === 'application-invite',
      );
      return await buildApplicationInviteTemplate(
        getScenarioOrThrow(template, args.scenario).props,
      );
    }
    case 'delete-account': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'delete-account'> =>
          candidate.id === 'delete-account',
      );
      return await buildDeleteAccountTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'stale-account-user': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'stale-account-user'> =>
          candidate.id === 'stale-account-user',
      );
      return await buildStaleAccountUserTemplate(getScenarioOrThrow(template, args.scenario).props);
    }
    case 'stale-account-admin': {
      const template = EMAIL_PREVIEW_TEMPLATES.find(
        (candidate): candidate is EmailPreviewTemplateDefinition<'stale-account-admin'> =>
          candidate.id === 'stale-account-admin',
      );
      return await buildStaleAccountAdminTemplate(
        getScenarioOrThrow(template, args.scenario).props,
      );
    }
  }
}

export const renderEmailPreviewServerFn = createServerFn({ method: 'GET' })
  .inputValidator(emailPreviewRequestSchema)
  .handler(async ({ data }) => {
    try {
      await requireAdmin();
      return await renderEmailPreview(data);
    } catch (error) {
      throw handleServerError(error, 'Render admin email preview');
    }
  });
