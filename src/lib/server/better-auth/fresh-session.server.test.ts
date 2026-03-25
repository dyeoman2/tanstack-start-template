import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STEP_UP_REQUIREMENTS } from '~/lib/shared/auth-policy';

const fetchAuthQueryMock = vi.fn();
const getRequestMock = vi.fn();

vi.mock('@convex/_generated/api', () => ({
  api: {
    stepUp: {
      hasCurrentClaim: 'stepUp.hasCurrentClaim',
    },
  },
}));

vi.mock('~/features/auth/server/convex-better-auth-react-start', () => ({
  convexAuthReactStart: {
    fetchAuthQuery: (...args: unknown[]) => fetchAuthQueryMock(...args),
  },
}));

vi.mock('~/lib/server/better-auth/http', async () => {
  const actual = await vi.importActual<typeof import('~/lib/server/better-auth/http')>(
    '~/lib/server/better-auth/http',
  );

  return {
    ...actual,
    getBetterAuthRequest: () => getRequestMock(),
  };
});

import {
  hasStepUpClaim,
  hasStepUpClaimForCurrentRequest,
} from '~/lib/server/better-auth/fresh-session.server';

describe('fresh-session.server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestMock.mockReturnValue(new Request('http://127.0.0.1:3000/app'));
  });

  it('returns whether the current request has a valid step-up claim', async () => {
    fetchAuthQueryMock.mockResolvedValue(true);

    await expect(hasStepUpClaim(STEP_UP_REQUIREMENTS.organizationAdmin)).resolves.toBe(true);
    expect(fetchAuthQueryMock).toHaveBeenCalledWith('stepUp.hasCurrentClaim', {
      requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
    });
  });

  it('fails closed when the profile query cannot resolve the claim', async () => {
    fetchAuthQueryMock.mockRejectedValue(new Error('boom'));

    await expect(hasStepUpClaim(STEP_UP_REQUIREMENTS.organizationAdmin)).resolves.toBe(false);
  });

  it('evaluates the current server request through the same claim query', async () => {
    fetchAuthQueryMock.mockResolvedValue(true);

    await expect(
      hasStepUpClaimForCurrentRequest(STEP_UP_REQUIREMENTS.accountEmailChange),
    ).resolves.toBe(true);
    expect(getRequestMock).toHaveBeenCalledTimes(1);
  });
});
