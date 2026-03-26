import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkStorageRuntimeEnv } from '../../scripts/lib/deploy-doctor-checks';
import { getRequiredStorageDrEnvKeys } from '../../scripts/lib/setup-dr';
import {
  CONVEX_STORAGE_RUNTIME_ENV_NAMES,
  LEGACY_FORBIDDEN_STORAGE_ENV_NAMES,
} from '../../scripts/lib/storage-env-contract';

function walkFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(absolutePath));
      continue;
    }
    results.push(absolutePath);
  }

  return results;
}

function relativeRepoPath(absolutePath: string) {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
}

function isAllowedLegacyReference(relativePath: string, token: string) {
  if (
    relativePath === 'scripts/lib/storage-env-contract.ts' ||
    relativePath === 'src/test/storage-env-contract-hygiene.test.ts'
  ) {
    return true;
  }

  if (token.startsWith('AWS_STORAGE_ROLE_ARN_')) {
    return [
      'infra/aws-cdk/lib/malware-scan-stack.cts',
      'infra/aws-cdk/runtime/storage-broker.ts',
      'infra/aws-cdk/runtime/storage-worker.ts',
      'src/lib/server/storage-service-env.ts',
    ].includes(relativePath);
  }

  if (token === 'AWS_MALWARE_WEBHOOK_SHARED_SECRET') {
    return [
      'src/lib/server/env.server.ts',
      'src/lib/server/env.server.test.ts',
      'src/lib/server/storage-service-env.ts',
    ].includes(relativePath);
  }

  if (token === 'AWS_CONVEX_STORAGE_CALLBACK_SHARED_SECRET') {
    return ['scripts/setup-storage.ts', 'scripts/setup-storage-prod.ts'].includes(relativePath);
  }

  if (token === 'CONVEX_STORAGE_CALLBACK_SHARED_SECRET') {
    return ['scripts/setup-storage.ts', 'scripts/setup-storage-prod.ts'].includes(relativePath);
  }

  if (
    token === 'AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET' ||
    token === 'AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET'
  ) {
    return [
      'scripts/setup-storage.ts',
      'scripts/setup-storage-prod.ts',
      'src/lib/server/env.server.ts',
      'src/lib/server/env.server.test.ts',
      'src/lib/server/storage-service-env.ts',
    ].includes(relativePath);
  }

  return false;
}

describe('storage env contract', () => {
  it('keeps DR recovery keys aligned with the shared Convex storage runtime contract', () => {
    expect(getRequiredStorageDrEnvKeys({ FILE_STORAGE_BACKEND: 's3-primary' })).toEqual(
      CONVEX_STORAGE_RUNTIME_ENV_NAMES,
    );
  });

  it('treats forbidden legacy storage envs as a deploy-doctor failure', () => {
    const checks: Array<{ check: string; detail?: string; status: 'pass' | 'warn' | 'fail' }> = [];

    expect(
      checkStorageRuntimeEnv(
        'Convex dev',
        {
          FILE_STORAGE_BACKEND: 's3-primary',
          AWS_STORAGE_ROLE_ARN_UPLOAD_PRESIGN: 'arn:aws:iam::123:role/upload',
        },
        checks,
      ),
    ).toBe(false);
    expect(checks).toContainEqual(
      expect.objectContaining({
        check: 'Forbidden legacy storage env (Convex dev)',
        status: 'fail',
      }),
    );
  });
});

describe('storage env hygiene', () => {
  it('does not reintroduce legacy storage env names outside allowed internal files', () => {
    const searchRoots = ['docs', 'scripts', 'src', 'infra'].map((segment) =>
      path.join(process.cwd(), segment),
    );
    const findings: string[] = [];

    for (const root of searchRoots) {
      if (!statSync(root).isDirectory()) {
        continue;
      }

      for (const absolutePath of walkFiles(root)) {
        const relativePath = relativeRepoPath(absolutePath);
        const contents = readFileSync(absolutePath, 'utf8');

        for (const token of LEGACY_FORBIDDEN_STORAGE_ENV_NAMES) {
          if (!contents.includes(token)) {
            continue;
          }
          if (isAllowedLegacyReference(relativePath, token)) {
            continue;
          }
          findings.push(`${relativePath}: ${token}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
