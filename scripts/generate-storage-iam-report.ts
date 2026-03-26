#!/usr/bin/env tsx

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type Statement = {
  Action?: unknown;
  Effect?: string;
  Principal?: unknown;
  Resource?: unknown;
};

type RoleSummary = {
  assumePrincipal: string;
  logicalId: string;
  roleName: string;
  statements: Array<{
    actions: string[];
    effect: string;
    resources: string[];
  }>;
};

type GenerateOptions = {
  envOverrides?: Record<string, string>;
  outDir?: string;
  projectSlug?: string;
  stage?: 'dev' | 'prod';
};

const DEFAULT_OUTPUT_PATH = path.join(process.cwd(), 'docs', 'generated', 'storage-iam-report.md');

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function toCellValues(value: unknown): string[] {
  return toArray(value).map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)));
}

function stringifyPrincipal(principal: unknown): string {
  if (typeof principal === 'string') {
    return principal;
  }
  if (principal && typeof principal === 'object') {
    return JSON.stringify(principal);
  }
  return 'unknown';
}

function loadSynthTemplate(options: GenerateOptions = {}) {
  const stage = options.stage ?? 'dev';
  const projectSlug = options.projectSlug ?? 'tanstack-start-template';
  const stackName = `${projectSlug}-${stage}-guardduty-stack`;
  const synthOutDir = options.outDir ?? mkdtempSync(path.join(tmpdir(), 'storage-iam-report-'));
  const cleanup = !options.outDir;

  const env = {
    ...process.env,
    ...options.envOverrides,
    AWS_REGION: 'us-west-1',
    AWS_STORAGE_PROJECT_SLUG: projectSlug,
    AWS_CONVEX_STORAGE_CALLBACK_BASE_URL:
      process.env.AWS_CONVEX_STORAGE_CALLBACK_BASE_URL ?? 'https://example.convex.site',
    AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET:
      process.env.AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET ?? 'decision-secret',
    AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET:
      process.env.AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET ?? 'document-secret',
    AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET:
      process.env.AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET ?? 'inspection-secret',
    AWS_FILE_SERVE_SIGNING_SECRET: process.env.AWS_FILE_SERVE_SIGNING_SECRET ?? 'file-serve-secret',
    AWS_STORAGE_BROKER_CONTROL_ASSERTION_SECRET:
      process.env.AWS_STORAGE_BROKER_CONTROL_ASSERTION_SECRET ?? 'control-broker-secret',
    AWS_STORAGE_BROKER_EDGE_ASSERTION_SECRET:
      process.env.AWS_STORAGE_BROKER_EDGE_ASSERTION_SECRET ?? 'edge-broker-secret',
    AWS_S3_QUARANTINE_BUCKET_NAME:
      process.env.AWS_S3_QUARANTINE_BUCKET_NAME ?? `${projectSlug}-${stage}-quarantine`,
    AWS_S3_CLEAN_BUCKET_NAME:
      process.env.AWS_S3_CLEAN_BUCKET_NAME ?? `${projectSlug}-${stage}-clean`,
    AWS_S3_REJECTED_BUCKET_NAME:
      process.env.AWS_S3_REJECTED_BUCKET_NAME ?? `${projectSlug}-${stage}-rejected`,
    AWS_S3_MIRROR_BUCKET_NAME:
      process.env.AWS_S3_MIRROR_BUCKET_NAME ?? `${projectSlug}-${stage}-mirror`,
    CDK_DEFAULT_ACCOUNT: '111111111111',
    CDK_DEFAULT_REGION: 'us-west-1',
    STORAGE_STAGE: stage,
  };

  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'cdk',
      'synth',
      '--app',
      'node ./infra/aws-cdk/bin/app.mjs',
      stackName,
      '--output',
      synthOutDir,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to synthesize storage stack.');
  }

  const templatePath = path.join(synthOutDir, `${stackName}.template.json`);
  const template = JSON.parse(readFileSync(templatePath, 'utf8')) as {
    Resources?: Record<string, { Properties?: Record<string, unknown>; Type?: string }>;
  };

  return {
    cleanup,
    stackName,
    synthOutDir,
    template,
  };
}

export function synthesizeStorageStackTemplate(options: GenerateOptions = {}) {
  const { cleanup, synthOutDir, stackName, template } = loadSynthTemplate(options);
  try {
    return {
      stackName,
      template,
    };
  } finally {
    if (cleanup) {
      rmSync(synthOutDir, { force: true, recursive: true });
    }
  }
}

function collectRoleSummaries(template: {
  Resources?: Record<string, { Properties?: Record<string, unknown>; Type?: string }>;
}): RoleSummary[] {
  const resources = template.Resources ?? {};
  const roleMap = new Map<string, RoleSummary>();

  for (const [logicalId, resource] of Object.entries(resources)) {
    if (resource.Type !== 'AWS::IAM::Role') {
      continue;
    }

    const assumeStatements = toArray(
      (resource.Properties?.AssumeRolePolicyDocument as { Statement?: Statement[] } | undefined)
        ?.Statement,
    ) as Statement[];
    const inlinePolicies = toArray(resource.Properties?.Policies) as Array<{
      PolicyDocument?: { Statement?: Statement[] };
    }>;
    roleMap.set(logicalId, {
      assumePrincipal: assumeStatements
        .map((statement) => stringifyPrincipal(statement.Principal))
        .join(', '),
      logicalId,
      roleName:
        typeof resource.Properties?.RoleName === 'string'
          ? resource.Properties.RoleName
          : logicalId,
      statements: inlinePolicies.flatMap((policy) =>
        toArray(policy.PolicyDocument?.Statement).map((statement) => ({
          actions: toCellValues((statement as Statement).Action),
          effect: (statement as Statement).Effect ?? 'Allow',
          resources: toCellValues((statement as Statement).Resource),
        })),
      ),
    });
  }

  for (const resource of Object.values(resources)) {
    if (resource.Type !== 'AWS::IAM::Policy') {
      continue;
    }

    const roles = toArray(resource.Properties?.Roles);
    const statements = toArray(
      (resource.Properties?.PolicyDocument as { Statement?: Statement[] } | undefined)?.Statement,
    ) as Statement[];
    for (const roleRef of roles) {
      const logicalId =
        roleRef && typeof roleRef === 'object' && 'Ref' in roleRef ? String(roleRef.Ref) : null;
      if (!logicalId) {
        continue;
      }
      const summary = roleMap.get(logicalId);
      if (!summary) {
        continue;
      }
      summary.statements.push(
        ...statements.map((statement) => ({
          actions: toCellValues(statement.Action),
          effect: statement.Effect ?? 'Allow',
          resources: toCellValues(statement.Resource),
        })),
      );
    }
  }

  return [...roleMap.values()]
    .filter(
      (role) =>
        role.roleName.includes('storage-') || role.roleName.includes('GuardDutyMalwarePlanRole'),
    )
    .sort((left, right) => left.roleName.localeCompare(right.roleName));
}

export function generateStorageIamReport(options: GenerateOptions = {}) {
  const { stackName, template } = synthesizeStorageStackTemplate(options);
  const roles = collectRoleSummaries(template);
  const lines = [
    '# Storage IAM Report',
    '',
    `Generated from synthesized stack template \`${stackName}\`.`,
    '',
    '| Role | Assume Principal | Effect | Actions | Resources |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const role of roles) {
    for (const statement of role.statements) {
      lines.push(
        `| ${role.roleName} | ${role.assumePrincipal} | ${statement.effect} | ${statement.actions.sort().join('<br>')} | ${statement.resources.sort().join('<br>')} |`,
      );
    }
  }

  return `${lines.join('\n')}\n`.replace(/\b\d{12}\b/g, '111111111111');
}

function main() {
  const check = process.argv.includes('--check');
  const stageArgIndex = process.argv.indexOf('--stage');
  const stage =
    stageArgIndex >= 0 &&
    (process.argv[stageArgIndex + 1] === 'dev' || process.argv[stageArgIndex + 1] === 'prod')
      ? (process.argv[stageArgIndex + 1] as 'dev' | 'prod')
      : 'dev';
  const outputPath =
    process.argv.indexOf('--out') >= 0
      ? path.resolve(process.cwd(), process.argv[process.argv.indexOf('--out') + 1] ?? '')
      : DEFAULT_OUTPUT_PATH;
  const report = generateStorageIamReport({ stage });

  if (check) {
    const current = readFileSync(outputPath, 'utf8');
    if (current !== report) {
      throw new Error(`Storage IAM report is out of date: ${outputPath}`);
    }
    return;
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report, 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
