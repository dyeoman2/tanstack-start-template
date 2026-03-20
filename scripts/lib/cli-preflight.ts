import { spawnSync } from 'node:child_process';

const SAFE_CMD = /^[a-z][a-z0-9._-]*$/i;

export const CLI_INSTALL_HINT: Record<string, string> = {
  aws: 'Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  curl: 'Install curl via your OS package manager (often preinstalled).',
  gh: 'Install GitHub CLI: https://cli.github.com/ — e.g. `brew install gh`',
  git: 'Install Git: https://git-scm.com/downloads — e.g. `brew install git`',
  jq: 'Install jq — e.g. `brew install jq`',
  netlify:
    'Install Netlify CLI: https://docs.netlify.com/cli/get-started/#installation — e.g. `npm i -g netlify-cli`',
  node: 'Install Node.js LTS: https://nodejs.org/',
  openssl: 'Install OpenSSL (usually preinstalled on macOS; Linux: `openssl` package).',
  pnpm: 'Install pnpm: https://pnpm.io/installation — e.g. `corepack enable && corepack prepare pnpm@latest --activate`',
};

/**
 * True if `cmd` is on PATH (POSIX `command -v`). Only simple command names (no spaces).
 */
export function commandOnPath(cmd: string): boolean {
  if (!SAFE_CMD.test(cmd)) {
    throw new Error(`Invalid CLI name for PATH lookup: ${cmd}`);
  }
  const r = spawnSync('sh', ['-lc', `command -v ${cmd}`], {
    stdio: 'ignore',
  });
  return r.status === 0;
}

export function pnpmExecConvexWorks(cwd = process.cwd()): boolean {
  if (!commandOnPath('pnpm')) {
    return false;
  }
  const r = spawnSync('pnpm', ['exec', 'convex', '--version'], {
    cwd,
    stdio: 'ignore',
  });
  return r.status === 0;
}

export function exitWithMissingClis(missing: ReadonlyArray<{ cmd: string; hint: string }>): never {
  console.error('\n❌ Required CLI tool(s) are not available on your PATH.\n');
  for (const m of missing) {
    console.error(`   • ${m.cmd}`);
    console.error(`     ${m.hint}\n`);
  }
  process.exit(1);
}

export function findMissingCommands(
  specs: ReadonlyArray<{ cmd: string; hint?: string }>,
): Array<{ cmd: string; hint: string }> {
  const missing: { cmd: string; hint: string }[] = [];
  for (const s of specs) {
    if (!commandOnPath(s.cmd)) {
      missing.push({
        cmd: s.cmd,
        hint: s.hint ?? CLI_INSTALL_HINT[s.cmd] ?? 'Install this tool, then retry.',
      });
    }
  }
  return missing;
}

/**
 * Exit with install hints if any listed command is missing.
 */
export function requireCommands(specs: ReadonlyArray<{ cmd: string; hint?: string }>): void {
  const missing = findMissingCommands(specs);
  if (missing.length > 0) {
    exitWithMissingClis(missing);
  }
}

/**
 * Ensures pnpm exists and the repo’s Convex CLI runs (`pnpm exec convex`).
 */
export function requirePnpmAndConvexCli(cwd = process.cwd()): void {
  if (!commandOnPath('pnpm')) {
    exitWithMissingClis([{ cmd: 'pnpm', hint: CLI_INSTALL_HINT.pnpm }]);
  }
  if (!pnpmExecConvexWorks(cwd)) {
    exitWithMissingClis([
      {
        cmd: 'convex (via pnpm exec)',
        hint: 'From the repo root run `pnpm install` so the `convex` package is available, then retry.',
      },
    ]);
  }
}
