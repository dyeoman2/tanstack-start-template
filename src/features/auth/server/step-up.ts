import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { STEP_UP_REQUIREMENTS } from '~/lib/shared/auth-policy';
import { createStepUpChallengeForCurrentUser } from './step-up.server';

const stepUpRedirectSchema = z.object({
  redirectTo: z
    .string()
    .regex(/^\/[a-zA-Z]/)
    .optional(),
});

export const createOrganizationAdminStepUpChallengeServerFn = createServerFn({ method: 'POST' })
  .inputValidator(stepUpRedirectSchema)
  .handler(async ({ data }) => {
    return await createStepUpChallengeForCurrentUser({
      redirectTo: data.redirectTo,
      requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
    });
  });

export const createSupportAccessApprovalStepUpChallengeServerFn = createServerFn({ method: 'POST' })
  .inputValidator(stepUpRedirectSchema)
  .handler(async ({ data }) => {
    return await createStepUpChallengeForCurrentUser({
      redirectTo: data.redirectTo,
      requirement: STEP_UP_REQUIREMENTS.supportAccessApproval,
    });
  });

export const createProfileEmailChangeStepUpChallengeServerFn = createServerFn({ method: 'POST' })
  .inputValidator(stepUpRedirectSchema)
  .handler(async ({ data }) => {
    return await createStepUpChallengeForCurrentUser({
      redirectTo: data.redirectTo ?? '/app/profile',
      requirement: STEP_UP_REQUIREMENTS.accountEmailChange,
    });
  });
