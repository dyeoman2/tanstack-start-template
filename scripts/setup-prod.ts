#!/usr/bin/env tsx

/**
 * Production deployment setup script.
 * Handles complete production setup including Convex bootstrap and GitHub deploy env setup.
 * Run: pnpm run setup:prod
 *
 * Flags: --yes (accept defaults / skip confirmations where safe),
 *        --env-file <path> (RESEND_API_KEY, CONVEX_DEPLOY_KEY, BETTER_AUTH_URL / DEPLOY_SMOKE_BASE_URL),
 *        --skip-github-deploy (Convex + Netlify + BETTER_AUTH_URL only),
 *        --create-netlify-site[=<name>] (clone linked primary site via Netlify API; requires netlify link),
 *        --smoke-base-url <url> (with --yes: non-interactive production smoke / BETTER_AUTH_URL).
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { convexDeployYes } from './lib/convex-cli';
import {
  ask,
  askInput,
  askRequired,
  askYesNo,
  chooseOrPromptSecret,
  configureGitHubDeployEnvironments,
  discoverLinkedNetlifySiteId,
  discoverNetlifyAuthToken,
  normalizeUrl,
  promptForProductionConvexDeployKey,
} from './lib/github-deploy-setup';
import {
  getConvexDeploymentEnvValue,
  printJwksRemediation,
  setConvexEnvJson,
  syncConvexJwksFromBetterAuth,
  verifyConvexJwksConfigured,
} from './lib/deploy-env-helpers';
import {
  createRepoBackedNetlifySite,
  formatNetlifySiteSummary,
  getNetlifySiteDetails,
  listNetlifySites,
  runNetlify,
  type NetlifySiteDetails,
  readNetlifyLinkedSiteIdFromDisk,
  resolveNetlifySite,
} from './lib/netlify-cli';
import {
  CLI_INSTALL_HINT,
  commandOnPath,
  findMissingCommands,
  requireCommands,
  requirePnpmAndConvexCli,
} from './lib/cli-preflight';
import { syncNetlifyProductionRuntimeAndBuildVars } from './lib/netlify-site-env';
import { DEFAULT_APP_NAME, DEFAULT_PROD_RESEND_SENDER } from './lib/setup-defaults';
import {
  emitStructuredOutput,
  printFinalChangeSummary,
  printStatusSummary,
  printTargetSummary,
  routeLogsToStderrWhenJson,
} from './lib/script-ux';

type ProdCliOptions = {
  createNetlifySite: string | null;
  envFile: string | null;
  json: boolean;
  plan: boolean;
  skipGithubDeploy: boolean;
  smokeBaseUrl: string | null;
  yes: boolean;
};

function printUsage() {
  console.log(
    'Usage: pnpm run setup:prod -- [--yes] [--env-file <path>] [--skip-github-deploy] [--create-netlify-site <name>] [--smoke-base-url <url>] [--plan] [--json]',
  );
  console.log('');
  console.log('Examples:');
  console.log('- pnpm run setup:prod');
  console.log(
    '- pnpm run setup:prod -- --yes --env-file .env.production.local --smoke-base-url https://app.example.com',
  );
  console.log('- pnpm run setup:prod -- --skip-github-deploy --create-netlify-site my-prod-site');
  console.log('- pnpm run setup:prod -- --plan --json');
  console.log('');
  console.log(
    'What this does: bootstrap Convex production, optionally sync Netlify production envs, optionally configure GitHub deploy environments, and set BETTER_AUTH_URL.',
  );
  console.log(
    'Use this instead of setup:github-deploy when you want the full Convex + Netlify + GitHub production path.',
  );
  console.log('Docs: docs/DEPLOY_ENVIRONMENT.md');
  console.log('Safe to rerun: mostly yes; it updates prod env/config state across providers.');
}

function parseProdCliArgs(): ProdCliOptions {
  const argv = process.argv.slice(2);
  let envFile: string | null = null;
  let createNetlifySite: string | null = null;
  let smokeBaseUrl: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--smoke-base-url') {
      smokeBaseUrl = argv[i + 1]?.trim() || null;
      i += 1;
      continue;
    }
    if (a.startsWith('--smoke-base-url=')) {
      smokeBaseUrl = a.slice('--smoke-base-url='.length).trim() || null;
      continue;
    }
    if (a === '--env-file') {
      envFile = argv[i + 1]?.trim() || null;
      i += 1;
      continue;
    }
    if (a.startsWith('--env-file=')) {
      envFile = a.slice('--env-file='.length).trim() || null;
      continue;
    }
    if (a === '--create-netlify-site') {
      createNetlifySite = argv[i + 1]?.trim() || null;
      i += 1;
      continue;
    }
    if (a.startsWith('--create-netlify-site=')) {
      createNetlifySite = a.slice('--create-netlify-site='.length).trim() || null;
    }
  }

  return {
    createNetlifySite,
    envFile,
    json: argv.includes('--json'),
    plan: argv.includes('--plan'),
    skipGithubDeploy: argv.includes('--skip-github-deploy'),
    smokeBaseUrl,
    yes: argv.includes('--yes') || argv.includes('--non-interactive'),
  };
}

function resolveConfiguredSmokeBaseUrl(
  opts: ProdCliOptions,
  envFromFile: Record<string, string>,
): string {
  const fromFlag = opts.smokeBaseUrl?.trim();
  if (fromFlag) {
    return fromFlag;
  }
  return (
    envFromFile.BETTER_AUTH_URL?.trim() ||
    envFromFile.DEPLOY_SMOKE_BASE_URL?.trim() ||
    process.env.DEPLOY_SMOKE_BASE_URL?.trim() ||
    ''
  );
}

function loadEnvFileMap(filePath: string): Record<string, string> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const content = readFileSync(resolved, 'utf8');
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      continue;
    }
    const eq = t.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

async function setupConvexProduction(options?: {
  openRouterApiKey?: string;
  resendApiKey?: string;
}): Promise<{
  betterAuthSecret: string;
  convexSiteUrl: string;
  convexUrl: string;
  deploymentName: string;
  deployOutput: string;
} | null> {
  console.log('\n🚀 Setting up Convex production...');

  const betterAuthSecret = execSync('openssl rand -base64 32', { encoding: 'utf8' }).trim();

  console.log('\n⚙️  Setting production environment variables...');

  const prodEnvVars: { name: string; value: string }[] = [
    { name: 'BETTER_AUTH_SECRET', value: betterAuthSecret },
    { name: 'APP_NAME', value: DEFAULT_APP_NAME },
    { name: 'RESEND_EMAIL_SENDER', value: DEFAULT_PROD_RESEND_SENDER },
  ];

  if (options?.resendApiKey) {
    prodEnvVars.push({ name: 'RESEND_API_KEY', value: options.resendApiKey });
  }
  if (options?.openRouterApiKey) {
    prodEnvVars.push({ name: 'OPENROUTER_API_KEY', value: options.openRouterApiKey });
  }

  for (const { name, value } of prodEnvVars) {
    try {
      console.log(`   Setting ${name}...`);
      setConvexEnvJson(name, value, 'prod');
    } catch {
      console.log(`   ⚠️  Failed to set ${name} (may already be set or you may not have access)`);
    }
  }

  console.log('\n🚀 Deploying to Convex production...');
  const { stdout, stderr, status } = convexDeployYes();
  const deployOutput = [stdout, stderr].filter(Boolean).join('\n');

  if (status !== 0) {
    console.log(
      '❌ Convex deployment failed. You can try again later with: pnpm exec convex deploy',
    );
    console.log('   Make sure you have the correct permissions and environment variables set.');
    throw new Error('Convex deployment failed');
  }

  console.log('✅ Convex production deployment complete!\n');

  if (!verifyConvexJwksConfigured('prod')) {
    console.log('🔑 JWKS missing — fetching from Better Auth and pushing to Convex production...');
    try {
      syncConvexJwksFromBetterAuth('prod');
    } catch {
      printJwksRemediation('prod');
    }
    if (!verifyConvexJwksConfigured('prod')) {
      printJwksRemediation('prod');
    }
  }

  const deploymentMatches = Array.from(
    deployOutput.matchAll(/https:\/\/([a-z0-9-]+)\.convex\.cloud\b/g),
  );
  const deploymentName = deploymentMatches.at(-1)?.[1];
  if (deploymentName) {
    const convexUrl = `https://${deploymentName}.convex.cloud`;
    return {
      betterAuthSecret,
      convexSiteUrl: `${convexUrl.replace('.convex.cloud', '.convex.site')}`,
      convexUrl,
      deploymentName,
      deployOutput,
    };
  }

  return null;
}

function getRepositoryUrl() {
  try {
    const gitRemote = execSync('git config --get remote.origin.url', {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).trim();

    if (gitRemote.startsWith('git@')) {
      return gitRemote.replace('git@github.com:', 'https://github.com/').replace('.git', '');
    }

    if (gitRemote.startsWith('https://')) {
      return gitRemote.replace('.git', '');
    }
  } catch {
    // Fall through.
  }

  return 'your GitHub repository URL';
}

function getExistingProdBetterAuthUrl() {
  return getConvexDeploymentEnvValue('BETTER_AUTH_URL', 'prod') ?? '';
}

function runInteractiveCommand(command: string, env?: NodeJS.ProcessEnv) {
  execSync(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: 'inherit',
  });
}

function isNetlifyCliReady() {
  if (!commandOnPath('netlify')) {
    return false;
  }

  return runNetlify(['status', '--json']).ok;
}

function printMissingCliSummary(
  title: string,
  missing: ReadonlyArray<{ cmd: string; hint: string }>,
) {
  if (missing.length === 0) {
    return;
  }

  console.log(`\n${title}`);
  for (const item of missing) {
    console.log(`- ${item.cmd}: ${item.hint}`);
  }
}

function getGitHubAuthStatus() {
  if (!commandOnPath('gh')) {
    return 'cli missing';
  }
  return spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' }).status === 0
    ? 'ready'
    : 'run `gh auth login`';
}

function getNetlifyAuthStatus() {
  if (!commandOnPath('netlify')) {
    return 'cli missing';
  }
  return runNetlify(['status', '--json']).ok ? 'ready' : 'run `netlify login`';
}

async function chooseProductionNetlifySite(
  linkedSite: NetlifySiteDetails | null,
): Promise<NetlifySiteDetails | null> {
  if (!isNetlifyCliReady()) {
    return linkedSite;
  }

  const knownSites = listNetlifySites();
  if (linkedSite) {
    const useLinked = await askYesNo(
      `Use linked Netlify site ${formatNetlifySiteSummary(linkedSite) ?? linkedSite.id} for production?`,
      true,
    );
    if (useLinked) {
      return linkedSite;
    }
  }

  if (knownSites.length > 0) {
    console.log('\nKnown Netlify sites:');
    for (const site of knownSites.slice(0, 10)) {
      console.log(`- ${formatNetlifySiteSummary(site) ?? site.id}`);
    }
    if (knownSites.length > 10) {
      console.log(`- ...and ${knownSites.length - 10} more`);
    }
  }

  const siteInput = await askInput(
    'Netlify site id or name to use for production (leave empty to create one if possible): ',
    linkedSite?.id,
  );
  const resolved = siteInput ? resolveNetlifySite(siteInput) : null;
  if (resolved?.id) {
    return getNetlifySiteDetails(resolved.id) ?? linkedSite;
  }

  if (linkedSite) {
    const shouldCreate = await askYesNo(
      'Create a new repo-backed Netlify production site now using the linked site settings?',
      false,
    );
    if (shouldCreate) {
      const desiredName = await askRequired('New Netlify production site name: ');
      const created = createRepoBackedNetlifySite({
        desiredName,
        primarySite: linkedSite,
      });
      if (created?.id) {
        console.log(`✅ Created Netlify site ${formatNetlifySiteSummary(created) ?? created.id}.`);
        return getNetlifySiteDetails(created.id) ?? created;
      }
      console.log('⚠️  Failed to create the Netlify site automatically.');
    }
  }

  return linkedSite;
}

function getNetlifySiteOrigin(
  site: Pick<NetlifySiteDetails, 'sslUrl' | 'url'> | null,
): string | null {
  const origin = site?.sslUrl?.trim() || site?.url?.trim() || '';
  return origin ? normalizeUrl(origin) : null;
}

function getLinkedProductionNetlifySite(): NetlifySiteDetails | null {
  const linkedSiteId = readNetlifyLinkedSiteIdFromDisk();
  if (!linkedSiteId) {
    return null;
  }
  return getNetlifySiteDetails(linkedSiteId);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const opts = parseProdCliArgs();
  routeLogsToStderrWhenJson(opts.json);
  const changedLocally: string[] = [];
  const changedRemotely: string[] = [];
  const nextCommands: string[] = [];
  const warnings: string[] = [];
  const readiness: Record<string, string> = {
    ai: 'pending',
    convex: 'pending',
    email: 'pending',
    github: opts.skipGithubDeploy ? 'skipped' : 'pending',
    netlify: 'pending',
    storage: 'skipped',
    dr: 'skipped',
  };

  try {
    console.log('🚀 Production deployment setup\n');
    console.log(
      'What this does: configure Convex production, Netlify production env, GitHub deploy environments, and smoke/BETTER_AUTH_URL.',
    );
    console.log(
      'Needs before full success: Convex prod access, git remote, optional gh auth, optional netlify auth, and a production site URL.',
    );
    console.log(
      'Modifies: Convex prod env, optional Netlify prod env, optional GitHub env secrets/vars.',
    );
    console.log('Safe to rerun: yes with care; this refreshes live production configuration.\n');
    const requiredMissing = findMissingCommands([{ cmd: 'pnpm' }, { cmd: 'openssl' }]);
    if (requiredMissing.length > 0) {
      printMissingCliSummary('Missing required CLIs', requiredMissing);
      process.exit(1);
    }
    const optionalMissing = findMissingCommands([
      ...(opts.skipGithubDeploy ? [] : ([{ cmd: 'git' }, { cmd: 'gh' }] as const)),
      { cmd: 'netlify' },
    ]);
    printMissingCliSummary('Before you enable optional provider automation', optionalMissing);
    printStatusSummary('Provider auth status', [
      { label: 'GitHub', value: opts.skipGithubDeploy ? 'skipped' : getGitHubAuthStatus() },
      { label: 'Netlify', value: getNetlifyAuthStatus() },
    ]);
    const planEnvFromFile = opts.envFile ? loadEnvFileMap(opts.envFile) : {};
    const planLinkedSite = getLinkedProductionNetlifySite();
    const planLinkedSiteOrigin = getNetlifySiteOrigin(planLinkedSite);
    printTargetSummary('Target summary', [
      `git remote: ${getRepositoryUrl()}`,
      `linked Netlify site: ${formatNetlifySiteSummary(planLinkedSite) ?? 'not linked'}`,
      `linked Netlify origin: ${planLinkedSiteOrigin ?? 'unknown'}`,
      `GitHub deploy setup: ${opts.skipGithubDeploy ? 'skip' : 'included'}`,
      `env file: ${opts.envFile ?? 'none'}`,
    ]);
    if (opts.plan) {
      const planSummary = {
        mode: 'plan',
        changedLocally: [],
        changedRemotely: [
          'Convex production env: BETTER_AUTH_SECRET, APP_NAME, RESEND_EMAIL_SENDER, optional RESEND_API_KEY',
          'Convex production deploy',
          'Optional Netlify production env: VITE_CONVEX_URL',
          'Optional Convex production env: BETTER_AUTH_URL',
          opts.skipGithubDeploy
            ? 'GitHub deploy environments skipped'
            : 'GitHub environments/secrets/vars for staging and production',
        ],
        nextCommands: ['pnpm run setup:prod', 'pnpm run deploy:doctor -- --prod'],
        readiness: {
          ai:
            planEnvFromFile.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()
              ? 'would configure'
              : 'optional / unknown',
          convex: 'would configure',
          email: planEnvFromFile.RESEND_API_KEY?.trim() ? 'would configure' : 'optional / unknown',
          github: opts.skipGithubDeploy ? 'skipped' : 'would configure',
          netlify: commandOnPath('netlify') ? getNetlifyAuthStatus() : 'cli missing',
          storage: 'optional',
          dr: 'optional',
        },
        targets: {
          linkedNetlifySite: formatNetlifySiteSummary(planLinkedSite),
          linkedNetlifyOrigin: planLinkedSiteOrigin,
          smokeBaseUrl:
            resolveConfiguredSmokeBaseUrl(opts, planEnvFromFile) ||
            getExistingProdBetterAuthUrl() ||
            planLinkedSiteOrigin ||
            null,
        },
      };
      if (opts.json) {
        emitStructuredOutput(planSummary);
      } else {
        printFinalChangeSummary(planSummary);
      }
      return;
    }

    if (opts.createNetlifySite) {
      requireCommands([{ cmd: 'netlify' }]);
      const linked = readNetlifyLinkedSiteIdFromDisk();
      if (!linked) {
        console.error(
          '❌ --create-netlify-site requires a linked primary site (.netlify/state.json).',
        );
        console.error('   Run `netlify link` on your main production site first.');
        process.exit(1);
      }
      const primary = getNetlifySiteDetails(linked);
      if (!primary) {
        console.error('❌ Could not load Netlify site details for the linked site id.');
        process.exit(1);
      }
      const created = createRepoBackedNetlifySite({
        desiredName: opts.createNetlifySite,
        primarySite: primary,
      });
      if (!created) {
        console.error('❌ Failed to create Netlify site via API.');
        process.exit(1);
      }
      console.log('\n🌐 Created Netlify site (build settings mirrored from linked primary):');
      console.log(`   ${formatNetlifySiteSummary(created) ?? created.id}\n`);
      changedRemotely.push(
        `Created Netlify site ${formatNetlifySiteSummary(created) ?? created.id}`,
      );
    }

    let envFromFile: Record<string, string> = {};
    if (opts.envFile) {
      try {
        envFromFile = loadEnvFileMap(opts.envFile);
      } catch (error) {
        console.error('❌ Could not read --env-file:', opts.envFile, error);
        process.exit(1);
      }
    }

    const shouldContinue =
      opts.yes || (await askYesNo('Ready to set up production deployment?', false));
    if (!shouldContinue) {
      console.log('👋 Setup cancelled.');
      return;
    }

    const resendFromFile = envFromFile.RESEND_API_KEY?.trim();
    const resendFromEnv = process.env.RESEND_API_KEY?.trim();
    let resendApiKeyInput = resendFromFile || resendFromEnv || '';
    if (!resendApiKeyInput && !opts.yes) {
      resendApiKeyInput = (
        await ask('RESEND_API_KEY for Convex production email (Enter to skip): ')
      ).trim();
      if (!resendApiKeyInput) {
        const continueWithoutResend = await askYesNo(
          'Continue without Resend email setup? Password reset and auth emails will stay unconfigured.',
          false,
        );
        if (!continueWithoutResend) {
          console.log('ℹ️  Finish Resend setup, then rerun `pnpm run setup:prod`.');
          console.log('   Docs: docs/RESEND_SETUP.md');
          return;
        }
        warnings.push('Email delivery remains unconfigured until RESEND_API_KEY is provided.');
        readiness.email = 'needs attention';
      }
    }
    if (resendApiKeyInput.length > 0) {
      readiness.email = 'ready';
    } else if (readiness.email === 'pending') {
      readiness.email = 'needs attention';
      warnings.push(
        'Password reset and auth email flows will not work until Resend is configured.',
      );
    }

    const openRouterFromFile = envFromFile.OPENROUTER_API_KEY?.trim();
    const openRouterFromEnv = process.env.OPENROUTER_API_KEY?.trim();
    let openRouterApiKeyInput = openRouterFromFile || openRouterFromEnv || '';
    if (!openRouterApiKeyInput && !opts.yes) {
      console.log('\n🤖 OpenRouter setup');
      console.log('- OpenRouter powers the chat and AI model features in this template.');
      if (commandOnPath('openrouter')) {
        console.log(
          '- OpenRouter CLI detected, but this script does not automate API key creation through it yet.',
        );
      } else {
        console.log('- No supported OpenRouter CLI automation detected here.');
        console.log(
          '- Create an API key at https://openrouter.ai/keys if you want chat features enabled.',
        );
      }
      openRouterApiKeyInput = (
        await ask('OPENROUTER_API_KEY for production chat/AI (Enter to skip): ')
      ).trim();
      if (!openRouterApiKeyInput) {
        warnings.push('Chat and AI model features will not work until OpenRouter is configured.');
      }
    }
    readiness.ai = openRouterApiKeyInput ? 'ready' : 'needs attention';

    requireCommands([{ cmd: 'openssl', hint: CLI_INSTALL_HINT.openssl }]);
    requirePnpmAndConvexCli();
    const convexInfo = await setupConvexProduction({
      openRouterApiKey: openRouterApiKeyInput.length > 0 ? openRouterApiKeyInput : undefined,
      resendApiKey: resendApiKeyInput.length > 0 ? resendApiKeyInput : undefined,
    });
    if (!convexInfo) {
      console.log(
        '⚠️  Could not determine Convex deployment information. Continuing with manual setup...',
      );
      readiness.convex = 'needs attention';
      warnings.push('Convex deployed, but deployment URLs could not be inferred automatically.');
    } else {
      readiness.convex = 'ready';
    }

    console.log('\n🔐 Production deploy key setup');
    console.log('CONVEX_DEPLOY_KEY is required for production deploys and CI/CD workflows.');
    const productionConvexDeployKey = await promptForProductionConvexDeployKey(
      envFromFile.CONVEX_DEPLOY_KEY?.trim() || process.env.CONVEX_DEPLOY_KEY?.trim() || null,
    );

    console.log('\n🌐 Netlify Deployment Setup');
    console.log('────────────────────────────');
    const linkedProductionSite = getLinkedProductionNetlifySite();
    let selectedProductionSite = linkedProductionSite;
    if (!commandOnPath('netlify')) {
      console.log(`⚠️  Netlify CLI is not installed. ${CLI_INSTALL_HINT.netlify}`);
      console.log(
        '   Install it, run `netlify login`, then rerun this command if you want automated Netlify setup.',
      );
      readiness.netlify = 'needs attention';
      warnings.push(
        'Netlify automation is unavailable until the Netlify CLI is installed and logged in.',
      );
    } else if (!runNetlify(['status', '--json']).ok) {
      console.log('⚠️  Netlify CLI is installed but not authenticated.');
      console.log(
        '   Run `netlify login`, then rerun this command if you want automated Netlify setup.',
      );
      readiness.netlify = 'needs attention';
      warnings.push('Netlify automation is unavailable until `netlify login` succeeds.');
    } else if (!opts.yes) {
      selectedProductionSite = await chooseProductionNetlifySite(linkedProductionSite);
    }

    console.log(
      `Detected production Netlify site: ${formatNetlifySiteSummary(selectedProductionSite) ?? 'not selected'}`,
    );
    console.log('Netlify needs these for build + SSR:');
    console.log(
      `   VITE_CONVEX_URL = ${convexInfo?.convexUrl ?? 'https://your-deployment.convex.cloud'}`,
    );
    console.log('   Convex site origin is derived automatically from VITE_CONVEX_URL.');
    console.log('');

    if (
      convexInfo &&
      (opts.yes || (await askYesNo('Set VITE_CONVEX_URL on Netlify production now?', true)))
    ) {
      requireCommands([{ cmd: 'netlify' }]);
      const netlifyToken = await chooseOrPromptSecret(
        'Netlify auth token',
        discoverNetlifyAuthToken(),
        discoverNetlifyAuthToken() === process.env.NETLIFY_AUTH_TOKEN?.trim()
          ? 'NETLIFY_AUTH_TOKEN'
          : discoverNetlifyAuthToken()
            ? 'local Netlify CLI config'
            : undefined,
      );
      const netlifySiteId = await askRequired(
        'Netlify site id: ',
        selectedProductionSite?.id ?? discoverLinkedNetlifySiteId() ?? undefined,
      );
      try {
        syncNetlifyProductionRuntimeAndBuildVars({
          authToken: netlifyToken,
          siteId: netlifySiteId.trim(),
          viteConvexUrl: convexInfo.convexUrl,
        });
        console.log('✅ Netlify production environment variables updated.');
        changedRemotely.push('Updated Netlify production env: VITE_CONVEX_URL');
        readiness.netlify = 'ready';
      } catch {
        console.log(
          '⚠️  Netlify env sync failed. Set the variable manually in Netlify UI, or run:',
        );
        console.log('   pnpm exec netlify env:set VITE_CONVEX_URL <url> --context production');
        readiness.netlify = 'needs attention';
        warnings.push('Netlify production env vars still need to be set manually.');
      }
    } else if (readiness.netlify === 'pending') {
      readiness.netlify = selectedProductionSite ? 'site selected, env sync skipped' : 'skipped';
    }

    let runGithubConfigure = true;
    if (opts.skipGithubDeploy) {
      runGithubConfigure = false;
      console.log('\nℹ️  GitHub deploy environment setup will be skipped (--skip-github-deploy).');
    } else {
      const readyForDeploySetup =
        opts.yes || (await askYesNo('Continue into GitHub deploy environment setup now?', true));
      if (!readyForDeploySetup) {
        console.log('ℹ️  Skipping GitHub deploy environment setup for now.');
        console.log('   Later run: pnpm run setup:github-deploy');
        return;
      }
    }

    const linkedProductionSiteOrigin = getNetlifySiteOrigin(selectedProductionSite);
    const configuredSmoke = resolveConfiguredSmokeBaseUrl(opts, envFromFile);
    const existingBetterAuthUrl = getExistingProdBetterAuthUrl();
    const inferredSmokeBaseUrl =
      configuredSmoke || existingBetterAuthUrl || linkedProductionSiteOrigin || '';
    if (opts.yes && !inferredSmokeBaseUrl) {
      console.error(
        '❌ `--yes` requires a production site origin for BETTER_AUTH_URL / smoke checks.',
      );
      console.error(
        '   Pass `--smoke-base-url https://your-site.example`, or link the production site with `netlify link`.',
      );
      process.exit(1);
    }
    const rawNetlifySiteUrl = opts.yes
      ? inferredSmokeBaseUrl
      : await askInput(
          '\nProduction Netlify URL for smoke checks/BETTER_AUTH_URL (press Enter to skip): ',
          existingBetterAuthUrl || configuredSmoke || linkedProductionSiteOrigin || undefined,
        );
    const normalizedNetlifySiteUrl = rawNetlifySiteUrl
      ? normalizeUrl(rawNetlifySiteUrl)
      : undefined;

    if (normalizedNetlifySiteUrl) {
      try {
        console.log(`\n🔐 Setting BETTER_AUTH_URL to ${normalizedNetlifySiteUrl}...`);
        setConvexEnvJson('BETTER_AUTH_URL', normalizedNetlifySiteUrl, 'prod');
        console.log('✅ BETTER_AUTH_URL configured in Convex production environment.');
        changedRemotely.push(`Set Convex production BETTER_AUTH_URL=${normalizedNetlifySiteUrl}`);
      } catch {
        console.log(
          '⚠️ Failed to set BETTER_AUTH_URL. You may need additional permissions or can try again later with:',
        );
        console.log(
          `   pnpm exec convex env set BETTER_AUTH_URL ${JSON.stringify(normalizedNetlifySiteUrl)} --prod`,
        );
      }
    } else {
      warnings.push('BETTER_AUTH_URL / smoke URL was not configured automatically.');
    }

    if (runGithubConfigure) {
      requireCommands([{ cmd: 'git' }, { cmd: 'gh' }]);
      const { repo } = await configureGitHubDeployEnvironments({
        productionConvexDeployKey,
        productionDeploySmokeBaseUrl: normalizedNetlifySiteUrl,
      });

      console.log('\n🎊 Production setup complete!');
      console.log(`- GitHub repo: ${repo}`);
      console.log('- GitHub environments configured: staging, production');
      console.log('- GitHub repo secret configured: CONVEX_DEPLOY_KEY');
      console.log(
        '- GitHub environment secrets configured: CONVEX_DEPLOY_KEY, NETLIFY_BUILD_HOOK_URL, NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID',
      );
      console.log('- GitHub environment variable configured: DEPLOY_SMOKE_BASE_URL');
      console.log('- DR setup remains separate: pnpm run dr:setup');
      changedRemotely.push(`Configured GitHub deploy environments for ${repo}`);
      nextCommands.push('pnpm run deploy:doctor -- --prod');
      nextCommands.push('pnpm run dr:setup');
      readiness.github = 'ready';
    } else {
      console.log('\n🎊 Production Convex / Netlify steps finished (GitHub deploy setup skipped).');
      console.log(
        '   Run `pnpm run setup:github-deploy` when you are ready to wire Actions environments.',
      );
      nextCommands.push('pnpm run setup:github-deploy');
      nextCommands.push('pnpm run deploy:doctor -- --prod');
      readiness.github = 'skipped';
      warnings.push(
        'GitHub deploy automation remains unconfigured until `pnpm run setup:github-deploy` runs.',
      );
    }

    console.log('\n📦 Production storage setup');
    try {
      runInteractiveCommand('pnpm run storage:setup:prod', {
        ...(convexInfo?.convexSiteUrl ? { CONVEX_SITE_URL: convexInfo.convexSiteUrl } : {}),
        ...(convexInfo?.convexUrl ? { VITE_CONVEX_URL: convexInfo.convexUrl } : {}),
      });
      changedRemotely.push('Ran guided production storage setup');
      readiness.storage = 'configured in follow-up flow';
    } catch {
      console.log(
        '⚠️  Production storage setup did not complete. You can rerun `pnpm run storage:setup:prod` later.',
      );
      readiness.storage = 'needs attention';
      warnings.push('Production storage setup was started but did not complete.');
    }

    console.log('\n📦 Optional production extras');
    if (!opts.yes) {
      console.log('Disaster recovery setup is optional.');
      console.log(
        'It provisions the separate DR backup/backend/frontend resources and related GitHub/Netlify wiring.',
      );
      const shouldSetupDr = await askYesNo('Configure disaster recovery setup now?', false);

      if (shouldSetupDr) {
        try {
          runInteractiveCommand('pnpm run dr:setup');
          changedRemotely.push('Ran guided disaster recovery setup');
          readiness.dr = 'configured in follow-up flow';
        } catch {
          console.log(
            '⚠️  Disaster recovery setup did not complete. You can rerun `pnpm run dr:setup` later.',
          );
          readiness.dr = 'needs attention';
          warnings.push('Disaster recovery setup was started but did not complete.');
        }
      } else {
        console.log('ℹ️  Skipping disaster recovery setup. Run `pnpm run dr:setup` any time.');
        readiness.dr = 'skipped';
        warnings.push('Disaster recovery remains unconfigured until `pnpm run dr:setup` runs.');
      }
    } else {
      console.log('ℹ️  Skipping optional disaster recovery setup in non-interactive mode.');
      console.log('   Run `pnpm run dr:setup` if you need disaster recovery wiring.');
    }
    if (opts.yes) {
      warnings.push('Disaster recovery setup was skipped in non-interactive mode.');
    }

    if (!nextCommands.includes('pnpm run storage:setup:prod')) {
      nextCommands.push('pnpm run storage:setup:prod');
    }
    if (!nextCommands.includes('pnpm run dr:setup')) {
      nextCommands.push('pnpm run dr:setup');
    }
    const finalSummary = { changedLocally, changedRemotely, nextCommands, readiness, warnings };
    if (opts.json) {
      emitStructuredOutput(finalSummary);
    } else {
      printFinalChangeSummary(finalSummary);
    }
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    console.log('\n💡 You can retry individual steps:');
    console.log('   • Convex: pnpm exec convex deploy');
    console.log('   • GitHub deploy envs: pnpm run setup:github-deploy');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
