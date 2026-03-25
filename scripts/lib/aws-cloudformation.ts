import { spawnSync } from 'node:child_process';

export type CloudFormationStackOutputs = Record<string, string>;

type CommandResult = {
  ok: boolean;
  stderr: string;
  stdout: string;
};

function runCommand(command: string, args: string[], env?: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    ok: result.status === 0,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function parseJson<T>(raw: string): T | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const start =
    objectStart >= 0 && arrayStart >= 0
      ? Math.min(objectStart, arrayStart)
      : objectStart >= 0
        ? objectStart
        : arrayStart;
  if (start < 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(start)) as T;
  } catch {
    return null;
  }
}

export function parseStackOutputs(
  items: Array<{ OutputKey?: string; OutputValue?: string }>,
): CloudFormationStackOutputs {
  const outputs: CloudFormationStackOutputs = {};
  for (const item of items) {
    if (item.OutputKey && item.OutputValue) {
      outputs[item.OutputKey] = item.OutputValue;
    }
  }
  return outputs;
}

export function getCloudFormationStackOutputs(input: {
  awsProfile?: string;
  region: string;
  stackName: string;
}): CloudFormationStackOutputs | null {
  const result = runCommand(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      input.stackName,
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json',
    ],
    {
      AWS_REGION: input.region,
      ...(input.awsProfile ? { AWS_PROFILE: input.awsProfile } : {}),
    },
  );

  if (!result.ok) {
    return null;
  }

  const parsed = parseJson<Array<{ OutputKey?: string; OutputValue?: string }>>(result.stdout);
  if (!parsed) {
    return null;
  }

  return parseStackOutputs(parsed);
}
