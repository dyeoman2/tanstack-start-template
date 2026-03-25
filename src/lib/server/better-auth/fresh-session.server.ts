import { api } from '@convex/_generated/api';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import type { StepUpRequirement } from '~/lib/shared/auth-policy';

export async function hasStepUpClaim(
  requirement: StepUpRequirement,
  _request?: Request,
): Promise<boolean> {
  try {
    return await convexAuthReactStart.fetchAuthQuery(api.stepUp.hasCurrentClaim, {
      requirement,
    });
  } catch {
    return false;
  }
}

export async function hasStepUpClaimForCurrentRequest(
  requirement: StepUpRequirement,
): Promise<boolean> {
  void getBetterAuthRequest();
  return await hasStepUpClaim(requirement);
}
