import { spawnSync } from 'node:child_process';

const PNPM = 'pnpm';

function formatConvexFailure(
  label: string,
  r: { status: number | null; stderr: string; stdout: string },
): Error {
  const detail = [r.stderr, r.stdout].filter(Boolean).join('\n').trim();
  return new Error(detail ? `${label}\n${detail}` : `${label} (exit ${r.status ?? 'unknown'})`);
}

/**
 * Run `pnpm exec convex …` with stdout+stderr captured (for parsers that tolerate npm noise).
 */
export function convexExecCaptured(args: string[]): string {
  const r = spawnSync(PNPM, ['exec', 'convex', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) {
    throw r.error;
  }
  if (r.status !== 0) {
    throw formatConvexFailure('convex CLI failed', r);
  }
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
}

/** Run convex; on failure throws including stderr/stdout. */
export function convexExecStdout(args: string[]): string {
  const r = spawnSync(PNPM, ['exec', 'convex', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) {
    throw r.error;
  }
  if (r.status !== 0) {
    throw formatConvexFailure('convex CLI failed', r);
  }
  return r.stdout ?? '';
}

export type ConvexDeployResult = {
  status: number | null;
  stderr: string;
  stdout: string;
};

export function convexEnvSet(name: string, value: string, prod: boolean) {
  const args = ['env', 'set', name, value];
  if (prod) {
    args.push('--prod');
  }
  convexExecStdout(args);
}

export function convexEnvList(prod: boolean): string {
  return convexExecStdout(prod ? ['env', 'list', '--prod'] : ['env', 'list']);
}

export function convexEnvRemove(name: string, prod: boolean) {
  const args = ['env', 'remove', name];
  if (prod) {
    args.push('--prod');
  }
  convexExecStdout(args);
}

/** `convex run <ref> <jsonArgs>` (e.g. `adminModelImports:importTopFreeModels` + `'{}'`). */
export function convexRun(functionRef: string, argsJson: string) {
  convexExecStdout(['run', functionRef, argsJson]);
}

/** `convex deploy --yes` with output captured for parsers and replayed to the terminal. */
export function convexDeployYes(): ConvexDeployResult {
  const r = spawnSync(PNPM, ['exec', 'convex', 'deploy', '--yes'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (r.stdout) {
    process.stdout.write(r.stdout);
  }
  if (r.stderr) {
    process.stderr.write(r.stderr);
  }
  return {
    status: r.status,
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}
