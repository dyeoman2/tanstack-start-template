import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SECRET_TIER_ACK_FLAG = '--ack-secret-tier';
export const SECRET_TIER_ACK_ENV = 'CONVEX_SECRET_TIER_ACK';
export const SECRET_TIER_RUNBOOK_PATH = 'docs/CONVEX_SECRET_TIER_ACCESS.md';

const SECRET_TIER_DOC_MARKERS = [
  {
    path: 'docs/AUTH_SECURITY.md',
    markers: ['secret-tier production access', 'active session rows as bearer-equivalent'],
  },
  {
    path: 'docs/DEPLOY_ENVIRONMENT.md',
    markers: [SECRET_TIER_ACK_ENV, SECRET_TIER_ACK_FLAG, SECRET_TIER_RUNBOOK_PATH],
  },
  {
    path: SECRET_TIER_RUNBOOK_PATH,
    markers: ['Quarterly access review', 'Session purge', 'CONVEX_DEPLOY_KEY'],
  },
] as const;

export type SecretTierDocumentationValidationResult = {
  detail: string;
  driftedFiles: string[];
  missingFiles: string[];
  ok: boolean;
};

export function hasSecretTierAcknowledgment(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (argv.includes(SECRET_TIER_ACK_FLAG)) {
    return true;
  }

  return env[SECRET_TIER_ACK_ENV]?.trim() === '1';
}

export function getSecretTierAcknowledgmentDetail() {
  return `Acknowledge with ${SECRET_TIER_ACK_FLAG} or ${SECRET_TIER_ACK_ENV}=1.`;
}

export function assertSecretTierAcknowledgment(input: {
  argv?: readonly string[];
  command: string;
  env?: NodeJS.ProcessEnv;
}) {
  if (hasSecretTierAcknowledgment(input.argv, input.env)) {
    return;
  }

  throw new Error(
    `Production Convex operator access is secret-tier production access. Re-run ${input.command} with ${SECRET_TIER_ACK_FLAG} or set ${SECRET_TIER_ACK_ENV}=1 for non-interactive automation.`,
  );
}

export function validateSecretTierDocumentation(
  cwd = process.cwd(),
): SecretTierDocumentationValidationResult {
  const driftedFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const document of SECRET_TIER_DOC_MARKERS) {
    const absolutePath = path.join(cwd, document.path);
    if (!existsSync(absolutePath)) {
      missingFiles.push(document.path);
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    if (!document.markers.every((marker) => content.includes(marker))) {
      driftedFiles.push(document.path);
    }
  }

  if (missingFiles.length === 0 && driftedFiles.length === 0) {
    return {
      detail: 'Secret-tier runbook and posture docs are present.',
      driftedFiles,
      missingFiles,
      ok: true,
    };
  }

  const parts: string[] = [];
  if (missingFiles.length > 0) {
    parts.push(`missing ${missingFiles.join(', ')}`);
  }
  if (driftedFiles.length > 0) {
    parts.push(`drifted ${driftedFiles.join(', ')}`);
  }

  return {
    detail: `Secret-tier posture docs are incomplete: ${parts.join('; ')}.`,
    driftedFiles,
    missingFiles,
    ok: false,
  };
}
