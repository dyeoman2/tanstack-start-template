import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { handleServerError } from '~/lib/server/error-utils.server';
import { STEP_UP_REQUIREMENTS, type StepUpRequirement } from '~/lib/shared/auth-policy';
import { normalizeAppRedirectTarget } from '../lib/account-setup-routing';

type StepUpChallengeSummary = {
  challengeId: string;
  redirectTo: string;
  requirement: StepUpRequirement;
};

async function createCurrentChallenge(
  requirement: StepUpRequirement,
  redirectTo?: string,
): Promise<StepUpChallengeSummary> {
  const normalizedRedirectTo = normalizeAppRedirectTarget(redirectTo);

  switch (requirement) {
    case STEP_UP_REQUIREMENTS.accountEmailChange:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentAccountEmailChangeChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.auditExport:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentAuditExportChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.attachmentAccess:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentAttachmentAccessChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.documentExport:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentDocumentExportChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.documentDeletion:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentDocumentDeletionChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.organizationAdmin:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentOrganizationAdminChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.sessionAdministration:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentSessionAdministrationChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
    case STEP_UP_REQUIREMENTS.userAdministration:
      return await convexAuthReactStart.fetchAuthMutation(
        api.stepUp.createCurrentUserAdministrationChallenge,
        {
          redirectTo: normalizedRedirectTo,
        },
      );
  }
}

export async function createStepUpChallengeForCurrentUser(input: {
  redirectTo?: string;
  requirement: StepUpRequirement;
}) {
  try {
    return await createCurrentChallenge(input.requirement, input.redirectTo);
  } catch (error) {
    throw handleServerError(error, 'Create step-up challenge');
  }
}
