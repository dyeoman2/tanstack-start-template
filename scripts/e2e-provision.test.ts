import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __private__ } from './lib/e2e-provision';

const ORIGINAL_ENV = { ...process.env };

type RecordedConvexCall = {
  args: Record<string, unknown>;
  functionRef: string;
  prod: boolean;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status,
  });
}

function getRequestPath(input: Request | URL | string): string {
  if (typeof input === 'string') {
    return new URL(input).pathname;
  }

  if (input instanceof URL) {
    return input.pathname;
  }

  return new URL(input.url).pathname;
}

function createFetchImpl(responses: Response[]) {
  const calls: string[] = [];

  const fetchImpl: typeof fetch = async (input) => {
    calls.push(getRequestPath(input));

    const nextResponse = responses.shift();
    if (!nextResponse) {
      throw new Error(`Unexpected fetch call for ${calls.at(-1) ?? 'unknown path'}`);
    }

    return nextResponse;
  };

  return {
    calls,
    fetchImpl,
  };
}

function createRunConvexJson(results: Record<string, unknown>) {
  const calls: RecordedConvexCall[] = [];

  const runConvexJson = <T>(
    functionRef: string,
    args: Record<string, unknown>,
    prod: boolean,
  ): T => {
    calls.push({
      args,
      functionRef,
      prod,
    });

    const result = results[functionRef];
    if (result === undefined) {
      throw new Error(`Unexpected convex run for ${functionRef}`);
    }

    return result as T;
  };

  return {
    calls,
    runConvexJson,
  };
}

describe('e2e-provision', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.E2E_USER_EMAIL = 'e2e-user@local.test';
    process.env.E2E_USER_PASSWORD = 'E2EUser!1234';
    process.env.E2E_USER_NAME = 'E2E User';
    process.env.E2E_ADMIN_EMAIL = 'e2e-admin@local.test';
    process.env.E2E_ADMIN_PASSWORD = 'E2EAdmin!1234';
    process.env.E2E_ADMIN_NAME = 'E2E Admin';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('reuses an existing principal and reconciles verification and role state', async () => {
    const { calls: fetchCalls, fetchImpl } = createFetchImpl([
      jsonResponse({ ok: true }),
      jsonResponse({ ok: true }),
    ]);
    const { calls: convexCalls, runConvexJson } = createRunConvexJson({
      'e2e:ensurePrincipalRole': {
        found: true,
        role: 'user',
        userId: 'user_123',
      },
      'e2e:verifyPrincipalEmailByEmail': {
        found: true,
        userId: 'user_123',
      },
    });

    const result = await __private__.ensurePrincipalProvisionedWithDependencies(
      {
        baseUrl: 'http://127.0.0.1:3000',
        principal: 'user',
        quiet: true,
      },
      {
        fetchImpl,
        runConvexJson,
      },
    );

    expect(fetchCalls).toEqual(['/api/auth/sign-in/email', '/api/auth/sign-in/email']);
    expect(convexCalls.map((call) => call.functionRef)).toEqual([
      'e2e:verifyPrincipalEmailByEmail',
      'e2e:ensurePrincipalRole',
    ]);
    expect(result).toEqual({
      created: false,
      email: 'e2e-user@local.test',
      principal: 'user',
      reset: false,
      userId: 'user_123',
    });
  });

  it('creates a missing principal and confirms it can sign in afterward', async () => {
    const { calls: fetchCalls, fetchImpl } = createFetchImpl([
      jsonResponse({ message: 'Invalid email or password' }, 401),
      jsonResponse({ ok: true }, 201),
      jsonResponse({ ok: true }),
    ]);
    const { calls: convexCalls, runConvexJson } = createRunConvexJson({
      'e2e:ensurePrincipalRole': {
        found: true,
        role: 'admin',
        userId: 'admin_123',
      },
      'e2e:verifyPrincipalEmailByEmail': {
        found: true,
        userId: 'admin_123',
      },
    });

    const result = await __private__.ensurePrincipalProvisionedWithDependencies(
      {
        baseUrl: 'http://127.0.0.1:3000',
        principal: 'admin',
        quiet: true,
      },
      {
        fetchImpl,
        runConvexJson,
      },
    );

    expect(fetchCalls).toEqual([
      '/api/auth/sign-in/email',
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
    ]);
    expect(convexCalls.map((call) => call.functionRef)).toEqual([
      'e2e:verifyPrincipalEmailByEmail',
      'e2e:ensurePrincipalRole',
    ]);
    expect(result).toEqual({
      created: true,
      email: 'e2e-admin@local.test',
      principal: 'admin',
      reset: false,
      userId: 'admin_123',
    });
  });

  it('resets broken duplicate state before retrying sign-up', async () => {
    const { calls: fetchCalls, fetchImpl } = createFetchImpl([
      jsonResponse({ message: 'Invalid email or password' }, 401),
      jsonResponse(
        {
          code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
          message: 'User already exists',
        },
        409,
      ),
      jsonResponse({ ok: true }, 201),
      jsonResponse({ ok: true }),
    ]);
    const { calls: convexCalls, runConvexJson } = createRunConvexJson({
      'e2e:ensurePrincipalRole': {
        found: true,
        role: 'user',
        userId: 'user_456',
      },
      'e2e:resetPrincipalByEmail': {
        found: true,
      },
      'e2e:verifyPrincipalEmailByEmail': {
        found: true,
        userId: 'user_456',
      },
    });

    const result = await __private__.ensurePrincipalProvisionedWithDependencies(
      {
        baseUrl: 'http://127.0.0.1:3000',
        principal: 'user',
        quiet: true,
      },
      {
        fetchImpl,
        runConvexJson,
      },
    );

    expect(fetchCalls).toEqual([
      '/api/auth/sign-in/email',
      '/api/auth/sign-up/email',
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
    ]);
    expect(convexCalls.map((call) => call.functionRef)).toEqual([
      'e2e:resetPrincipalByEmail',
      'e2e:verifyPrincipalEmailByEmail',
      'e2e:ensurePrincipalRole',
    ]);
    expect(result).toEqual({
      created: true,
      email: 'e2e-user@local.test',
      principal: 'user',
      reset: true,
      userId: 'user_456',
    });
  });

  it('fails closed when sign-up fails for a non-resettable reason', async () => {
    const { calls: fetchCalls, fetchImpl } = createFetchImpl([
      jsonResponse({ message: 'Invalid email or password' }, 401),
      jsonResponse({ message: 'Password does not meet policy' }, 400),
    ]);
    const { calls: convexCalls, runConvexJson } = createRunConvexJson({});

    await expect(
      __private__.ensurePrincipalProvisionedWithDependencies(
        {
          baseUrl: 'http://127.0.0.1:3000',
          principal: 'user',
          quiet: true,
        },
        {
          fetchImpl,
          runConvexJson,
        },
      ),
    ).rejects.toThrow(
      'Password does not meet policy (status 400). Run `pnpm run e2e:provision` after starting the local app, then retry the browser auth flow.',
    );

    expect(fetchCalls).toEqual(['/api/auth/sign-in/email', '/api/auth/sign-up/email']);
    expect(convexCalls).toEqual([]);
  });
});
