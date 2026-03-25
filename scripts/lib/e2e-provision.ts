import { getE2EPrincipalConfig, type E2EPrincipalType } from '../../src/lib/server/env.server';
import { requirePnpmAndConvexCli } from './cli-preflight';
import { convexExecCaptured } from './convex-cli';
import { sliceConvexCliJsonPayload } from './deploy-env-helpers';

type AuthRouteResponse = {
  code?: string;
  message?: string;
};

type EnsurePrincipalRoleResult =
  | {
      found: false;
    }
  | {
      found: true;
      role: E2EPrincipalType;
      userId: string;
    };

type VerifyPrincipalResult =
  | {
      found: false;
    }
  | {
      found: true;
      userId: string;
    };

export type ProvisionE2EPrincipalResult = {
  created: boolean;
  email: string;
  principal: E2EPrincipalType;
  reset: boolean;
  userId: string;
};

type EnsureE2EPrincipalProvisionedOptions = {
  baseUrl: string;
  principal: E2EPrincipalType;
  prod?: boolean;
  quiet?: boolean;
};

type EnsureProvisionedDependencies = {
  fetchImpl: typeof fetch;
  runConvexJson: <T>(functionRef: string, args: Record<string, unknown>, prod: boolean) => T;
};

function buildAuthEndpointHeaders(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  return new Headers({
    'content-type': 'application/json',
    origin,
    referer: `${origin}/`,
  });
}

async function readAuthError(response: Response): Promise<AuthRouteResponse> {
  try {
    return (await response.json()) as AuthRouteResponse;
  } catch {
    const message = await response.text();
    return { message };
  }
}

async function postToAuthEndpoint(
  fetchImpl: typeof fetch,
  input: {
    baseUrl: string;
    mode: 'sign-in' | 'sign-up';
    principal: ReturnType<typeof getE2EPrincipalConfig>;
  },
) {
  const path = input.mode === 'sign-up' ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email';
  const body =
    input.mode === 'sign-up'
      ? {
          email: input.principal.email,
          name: input.principal.name,
          password: input.principal.password,
          rememberMe: true,
        }
      : {
          email: input.principal.email,
          password: input.principal.password,
          rememberMe: true,
        };

  return fetchImpl(new URL(path, input.baseUrl), {
    body: JSON.stringify(body),
    headers: buildAuthEndpointHeaders(input.baseUrl),
    method: 'POST',
  });
}

function shouldResetAfterFailedSignUp(response: AuthRouteResponse, status: number) {
  if (response.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return true;
  }

  if (status === 409) {
    return true;
  }

  return /already exists|use another email/i.test(response.message ?? '');
}

function createProvisioningError(message: string, status?: number) {
  const details =
    'Run `pnpm run e2e:provision` after starting the local app, then retry the browser auth flow.';
  return new Error(status ? `${message} (status ${status}). ${details}` : `${message}. ${details}`);
}

function runConvexJson<T>(functionRef: string, args: Record<string, unknown>, prod: boolean): T {
  const cliArgs = ['run', functionRef, JSON.stringify(args)];
  if (prod) {
    cliArgs.push('--prod');
  }

  const output = convexExecCaptured(cliArgs);
  return JSON.parse(sliceConvexCliJsonPayload(output)) as T;
}

async function ensurePrincipalProvisionedWithDependencies(
  input: EnsureE2EPrincipalProvisionedOptions,
  dependencies: EnsureProvisionedDependencies,
): Promise<ProvisionE2EPrincipalResult> {
  const principal = getE2EPrincipalConfig(input.principal);
  const prod = input.prod ?? false;
  let created = false;
  let reset = false;

  const initialSignIn = await postToAuthEndpoint(dependencies.fetchImpl, {
    baseUrl: input.baseUrl,
    mode: 'sign-in',
    principal,
  });

  if (!initialSignIn.ok) {
    let signUpResponse = await postToAuthEndpoint(dependencies.fetchImpl, {
      baseUrl: input.baseUrl,
      mode: 'sign-up',
      principal,
    });

    if (!signUpResponse.ok) {
      const signUpError = await readAuthError(signUpResponse);
      if (!shouldResetAfterFailedSignUp(signUpError, signUpResponse.status)) {
        throw createProvisioningError(
          signUpError.message || `Failed to provision ${input.principal} E2E principal`,
          signUpResponse.status,
        );
      }

      dependencies.runConvexJson('e2e:resetPrincipalByEmail', { email: principal.email }, prod);
      reset = true;

      signUpResponse = await postToAuthEndpoint(dependencies.fetchImpl, {
        baseUrl: input.baseUrl,
        mode: 'sign-up',
        principal,
      });

      if (!signUpResponse.ok) {
        const retryError = await readAuthError(signUpResponse);
        throw createProvisioningError(
          retryError.message || `Failed to reprovision ${input.principal} E2E principal`,
          signUpResponse.status,
        );
      }
    }

    created = true;
  }

  const verificationResult = dependencies.runConvexJson<VerifyPrincipalResult>(
    'e2e:verifyPrincipalEmailByEmail',
    {
      email: principal.email,
    },
    prod,
  );
  if (!verificationResult.found) {
    throw createProvisioningError(`Failed to verify ${principal.email} for E2E auth`);
  }

  const ensureRoleResult = dependencies.runConvexJson<EnsurePrincipalRoleResult>(
    'e2e:ensurePrincipalRole',
    {
      email: principal.email,
      role: principal.role,
    },
    prod,
  );
  if (!ensureRoleResult.found) {
    throw createProvisioningError(
      `Failed to reconcile role and bootstrap context for ${principal.email}`,
    );
  }

  const finalSignIn = await postToAuthEndpoint(dependencies.fetchImpl, {
    baseUrl: input.baseUrl,
    mode: 'sign-in',
    principal,
  });
  if (!finalSignIn.ok) {
    const authError = await readAuthError(finalSignIn);
    throw createProvisioningError(
      authError.message || `Provisioned ${principal.email} but sign-in still failed`,
      finalSignIn.status,
    );
  }

  if (!input.quiet) {
    const statusParts = [];
    statusParts.push(created ? 'created' : 'reused');
    if (reset) {
      statusParts.push('reset');
    }
    console.log(
      `[e2e-provision] ${input.principal} principal ${principal.email}: ${statusParts.join(', ')}`,
    );
  }

  return {
    created,
    email: principal.email,
    principal: input.principal,
    reset,
    userId: ensureRoleResult.userId,
  };
}

export async function ensureE2EPrincipalProvisioned(
  input: EnsureE2EPrincipalProvisionedOptions,
): Promise<ProvisionE2EPrincipalResult> {
  requirePnpmAndConvexCli();
  return ensurePrincipalProvisionedWithDependencies(input, {
    fetchImpl: fetch,
    runConvexJson,
  });
}

export const __private__ = {
  ensurePrincipalProvisionedWithDependencies,
  postToAuthEndpoint,
  readAuthError,
  shouldResetAfterFailedSignUp,
};
