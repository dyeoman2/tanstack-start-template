import { spawnSync } from 'node:child_process';
import { convexEnvList } from './convex-cli';
import { getNetlifySiteDetails, readNetlifyLinkedSiteIdFromDisk, runNetlify } from './netlify-cli';

export type ProviderCheckResult = {
  detail: string;
  ok: boolean;
};

type CommandResult = {
  ok: boolean;
  stderr: string;
  stdout: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => CommandResult;

export function defaultCommandRunner(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: result.status === 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

export function checkAwsCredentials(input: {
  awsProfile?: string;
  region: string;
  runner?: CommandRunner;
}): ProviderCheckResult {
  const result = (input.runner ?? defaultCommandRunner)(
    'aws',
    ['sts', 'get-caller-identity', '--output', 'json'],
    {
      AWS_REGION: input.region,
      ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    },
  );

  return result.ok
    ? { detail: 'AWS credentials are ready.', ok: true }
    : {
        detail: 'AWS credentials are unavailable. Run `aws configure` or export AWS credentials.',
        ok: false,
      };
}

export function checkCdkBootstrap(input: {
  awsProfile?: string;
  region: string;
  runner?: CommandRunner;
  stackName?: string;
}): ProviderCheckResult {
  const stackName = input.stackName ?? 'CDKToolkit';
  const result = (input.runner ?? defaultCommandRunner)(
    'aws',
    ['cloudformation', 'describe-stacks', '--stack-name', stackName, '--output', 'json'],
    {
      AWS_REGION: input.region,
      ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    },
  );

  return result.ok
    ? { detail: `${stackName} bootstrap stack is present.`, ok: true }
    : {
        detail: `CDK bootstrap stack ${stackName} is missing or inaccessible. Run \`pnpm exec cdk bootstrap\` for the target account/region.`,
        ok: false,
      };
}

export function checkConvexProdAccess(
  listProdEnv: () => string = () => convexEnvList(true),
): ProviderCheckResult {
  try {
    listProdEnv();
    return {
      detail: 'Convex production env access is ready.',
      ok: true,
    };
  } catch {
    return {
      detail:
        'Convex production env access is unavailable. Confirm deployment access before syncing production env.',
      ok: false,
    };
  }
}

export function checkNetlifyMutationReadiness(input: {
  requireLinkedSite?: boolean;
  runStatus?: typeof runNetlify;
  resolveLinkedSiteId?: typeof readNetlifyLinkedSiteIdFromDisk;
  loadSiteDetails?: typeof getNetlifySiteDetails;
}): ProviderCheckResult {
  const statusRunner = input.runStatus ?? runNetlify;
  if (!statusRunner(['status', '--json']).ok) {
    return {
      detail: 'Netlify CLI is not authenticated. Run `netlify login` before mutating Netlify.',
      ok: false,
    };
  }

  if (!input.requireLinkedSite) {
    return { detail: 'Netlify CLI is authenticated.', ok: true };
  }

  const linkedSiteId = (input.resolveLinkedSiteId ?? readNetlifyLinkedSiteIdFromDisk)();
  if (!linkedSiteId) {
    return {
      detail: 'Netlify site is not linked. Run `netlify link` before mutating Netlify.',
      ok: false,
    };
  }

  const details = (input.loadSiteDetails ?? getNetlifySiteDetails)(linkedSiteId);
  if (!details) {
    return {
      detail:
        'Linked Netlify site details could not be loaded. Re-link the site or provide a valid site id.',
      ok: false,
    };
  }

  return { detail: 'Netlify CLI and linked site are ready.', ok: true };
}

export function checkGitHubMutationReadiness(
  runner: CommandRunner = defaultCommandRunner,
): ProviderCheckResult {
  const repoResult = runner('git', ['config', '--get', 'remote.origin.url']);
  if (!repoResult.ok) {
    return {
      detail:
        'Git remote origin is missing. Configure the repository remote before GitHub deploy setup.',
      ok: false,
    };
  }

  const authResult = runner('gh', ['auth', 'status']);
  if (!authResult.ok) {
    return {
      detail: 'GitHub CLI is not authenticated. Run `gh auth login` before GitHub deploy setup.',
      ok: false,
    };
  }

  return { detail: 'GitHub CLI and git remote are ready.', ok: true };
}

export function parseSnsSubscriptionConfirmed(
  output: string,
  expectedEndpoint: string,
): boolean | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      Subscriptions?: Array<{ Endpoint?: string; SubscriptionArn?: string }>;
    };
    const match = parsed.Subscriptions?.find(
      (subscription) =>
        (subscription.Endpoint ?? '').trim().toLowerCase() === expectedEndpoint.toLowerCase(),
    );
    if (!match) {
      return false;
    }

    const arn = (match.SubscriptionArn ?? '').trim();
    if (!arn) {
      return false;
    }

    return arn !== 'PendingConfirmation';
  } catch {
    return null;
  }
}

export function checkSnsEmailSubscriptionConfirmed(input: {
  awsProfile?: string;
  emailAddress: string;
  region: string;
  runner?: CommandRunner;
  topicArn: string;
}): ProviderCheckResult {
  const result = (input.runner ?? defaultCommandRunner)(
    'aws',
    ['sns', 'list-subscriptions-by-topic', '--topic-arn', input.topicArn, '--output', 'json'],
    {
      AWS_REGION: input.region,
      ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    },
  );

  if (!result.ok) {
    return {
      detail:
        'SNS subscription confirmation could not be verified. Confirm AWS access and the storage alert topic output.',
      ok: false,
    };
  }

  const confirmed = parseSnsSubscriptionConfirmed(result.stdout, input.emailAddress);
  if (confirmed === null) {
    return {
      detail: 'SNS subscription state could not be parsed from AWS output.',
      ok: false,
    };
  }

  return confirmed
    ? {
        detail: 'Storage alert SNS email subscription is confirmed.',
        ok: true,
      }
    : {
        detail: 'Storage alert SNS email subscription is missing or still pending confirmation.',
        ok: false,
      };
}
