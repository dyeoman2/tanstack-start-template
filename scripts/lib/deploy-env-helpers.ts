import { convexEnvList, convexEnvSet, convexExecCaptured } from './convex-cli';

export type ConvexDeploymentScope = 'dev' | 'prod';

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
  const prodFlag = scope === 'prod' ? ' --prod' : '';
  console.log('');
  console.log(`⚠️  JWKS is missing or unreadable on Convex ${target}.`);
  console.log(
    '   Better Auth needs JWKS in Convex for JWT verification (see convex/auth.config.ts).',
  );
  console.log(`   Try: pnpm run convex:jwks:sync${prodFlag ? ' -- --prod' : ''}`);
  console.log(
    '   Or:  pnpm exec convex run auth:getLatestJwks | pnpm exec convex env set JWKS' + prodFlag,
  );
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
  const jwks = parseConvexRunStdout(out);
  setConvexEnvJson('JWKS', jwks, scope);
}

export function setConvexEnvJson(name: string, value: string, scope: ConvexDeploymentScope) {
  convexEnvSet(name, value, scope === 'prod');
}

export function listConvexEnvForScope(scope: ConvexDeploymentScope): string {
  return convexEnvList(scope === 'prod');
}
