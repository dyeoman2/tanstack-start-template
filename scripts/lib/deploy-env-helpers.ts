import { convexEnvList, convexEnvSet, convexExecCaptured } from './convex-cli';

export type ConvexDeploymentScope = 'dev' | 'prod';

type BetterAuthJwksDoc = {
  id: string;
  publicKey: string;
};

type PublicJwks = {
  keys: JsonWebKey[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBetterAuthJwksDoc(value: unknown): value is BetterAuthJwksDoc {
  return isRecord(value) && typeof value.id === 'string' && typeof value.publicKey === 'string';
}

function isPublicJwks(value: unknown): value is PublicJwks {
  return isRecord(value) && Array.isArray(value.keys);
}

function normalizePublicJwk(value: unknown, fallbackKid: string): JsonWebKey {
  if (!isRecord(value)) {
    throw new Error('Better Auth returned a non-object public JWK.');
  }

  if (typeof value.k === 'string') {
    throw new Error('Better Auth returned a symmetric JWK; a public JWKS export is required.');
  }

  const normalized = { ...value } as JsonWebKey & Record<string, unknown>;
  normalized.kid =
    typeof normalized.kid === 'string' && normalized.kid.length > 0 ? normalized.kid : fallbackKid;
  delete normalized.d;
  delete normalized.dp;
  delete normalized.dq;
  delete normalized.k;
  delete normalized.oth;
  delete normalized.p;
  delete normalized.q;
  delete normalized.qi;
  return normalized;
}

export function normalizeBetterAuthJwksForEnv(rawJwks: string): string {
  const trimmed = rawJwks.trim();
  if (!trimmed) {
    throw new Error('Better Auth JWKS output is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Better Auth JWKS output is not valid JSON.');
  }

  if (isPublicJwks(parsed)) {
    return JSON.stringify(parsed);
  }

  if (!Array.isArray(parsed) || !parsed.every(isBetterAuthJwksDoc)) {
    throw new Error('Better Auth JWKS output is neither Better Auth key docs nor public JWKS.');
  }

  return JSON.stringify({
    keys: parsed.map((entry) => {
      let publicKey: unknown;
      try {
        publicKey = JSON.parse(entry.publicKey);
      } catch {
        throw new Error(`Better Auth returned an unreadable public JWK for key ${entry.id}.`);
      }

      return normalizePublicJwk(publicKey, entry.id);
    }),
  } satisfies PublicJwks);
}

/** Parses `convex env list` lines (`NAME=value`). */
export function parseConvexEnvListNames(listOutput: string): string[] {
  const names: string[] = [];
  for (const line of listOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    names.push(trimmed.slice(0, eq));
  }
  return names;
}

export function convexEnvGetArgs(scope: ConvexDeploymentScope): string {
  return scope === 'prod' ? ' --prod' : '';
}

/** Last substantive line from `convex env get` (URL, plain string, etc.). */
export function sliceConvexEnvScalar(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) => l.length > 0 && !l.startsWith('npm ') && !l.startsWith('✖') && !l.startsWith('> '),
    );
  return lines[lines.length - 1] ?? '';
}

export function getConvexDeploymentEnvValue(
  name: string,
  scope: ConvexDeploymentScope,
): string | null {
  try {
    const args = ['env', 'get', name];
    if (scope === 'prod') {
      args.push('--prod');
    }
    const out = convexExecCaptured(args);
    if (/not found/i.test(out)) {
      return null;
    }
    const t = sliceConvexEnvScalar(out);
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/** Strips CLI noise so we can read the Convex env payload. */
export function sliceConvexCliJsonPayload(raw: string): string {
  const lines = raw.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const t = lines[i]?.trim() ?? '';
    if (t.length > 0 && (t.startsWith('[') || t.startsWith('{'))) {
      return t;
    }
  }
  const trimmed = raw.trim();
  const idx = trimmed.search(/[[{]/u);
  return idx >= 0 ? trimmed.slice(idx) : trimmed;
}

/**
 * Confirms `JWKS` exists on the target Convex deployment (Better Auth + `auth.config.ts`).
 */
export function verifyConvexJwksConfigured(scope: ConvexDeploymentScope): boolean {
  try {
    const args = ['env', 'get', 'JWKS'];
    if (scope === 'prod') {
      args.push('--prod');
    }
    const out = convexExecCaptured(args);
    const text = sliceConvexCliJsonPayload(out);
    if (!text || /not found/i.test(out)) {
      return false;
    }
    return text.startsWith('[') || text.startsWith('{');
  } catch {
    return false;
  }
}

export function printJwksRemediation(scope: ConvexDeploymentScope) {
  const target = scope === 'prod' ? 'production' : 'development';
  console.log('');
  console.log(`⚠️  JWKS is missing or unreadable on Convex ${target}.`);
  console.log(
    '   Better Auth needs JWKS in Convex for JWT verification (see convex/auth.config.ts).',
  );
  console.log(`   Try: pnpm run convex:jwks:sync${scope === 'prod' ? ' -- --prod' : ''}`);
  console.log(
    '   After key rotation, run convex:jwks:sync again (see docs/DEPLOY_ENVIRONMENT.md).',
  );
  console.log('');
}

function sliceConvexRunPayloadLine(raw: string): string {
  const lines = raw.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const t = lines[i]?.trim() ?? '';
    if (t.length > 0 && (t.startsWith('[') || t.startsWith('{') || t.startsWith('"'))) {
      return t;
    }
  }
  return raw.trim();
}

/** `convex run` prints JSON; string results are often quoted. */
export function parseConvexRunStdout(stdout: string): string {
  const payload = sliceConvexRunPayloadLine(stdout);
  if (!payload) {
    throw new Error('Empty output from convex run');
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === 'string') {
      return parsed;
    }
    return JSON.stringify(parsed);
  } catch {
    return payload;
  }
}

/**
 * Fetches JWKS from Better Auth (`auth:getLatestJwks`) and sets Convex env `JWKS`.
 * @see https://labs.convex.dev/better-auth/experimental — Static JWKS
 */
export function syncConvexJwksFromBetterAuth(scope: ConvexDeploymentScope) {
  const args = ['run', 'auth:getLatestJwks', '{}'];
  if (scope === 'prod') {
    args.push('--prod');
  }
  const out = convexExecCaptured(args);
  const jwks = normalizeBetterAuthJwksForEnv(parseConvexRunStdout(out));
  setConvexEnvJson('JWKS', jwks, scope);
}

export function setConvexEnvJson(name: string, value: string, scope: ConvexDeploymentScope) {
  convexEnvSet(name, value, scope === 'prod');
}

export function listConvexEnvForScope(scope: ConvexDeploymentScope): string {
  return convexEnvList(scope === 'prod');
}
