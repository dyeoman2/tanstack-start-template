import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '..');

function runTsxScript(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('script cli smoke', () => {
  it('prints help for setup:prod', () => {
    const result = runTsxScript(['scripts/setup-prod.ts', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm run setup:prod');
  });

  it('rejects setup:prod mutation without secret-tier acknowledgment', () => {
    const result = runTsxScript(['scripts/setup-prod.ts', '--yes', '--json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-tier production access');
  });

  it('prints plan json for setup:prod', { timeout: 60000 }, () => {
    const result = runTsxScript(['scripts/setup-prod.ts', '--plan', '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.mode).toBe('plan');
  });

  it('prints help for dr:setup', () => {
    const result = runTsxScript(['scripts/setup-dr.ts', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm run dr:setup');
  });

  it('rejects dr:setup mutation without secret-tier acknowledgment', () => {
    const result = runTsxScript(['scripts/setup-dr.ts', '--yes', '--json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-tier production access');
  });

  it('prints help for audit-archive:setup', () => {
    const result = runTsxScript(['scripts/setup-audit-archive.ts', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm run audit-archive:setup');
  });

  it('rejects audit-archive:setup --prod mutation without secret-tier acknowledgment', () => {
    const result = runTsxScript(['scripts/setup-audit-archive.ts', '--prod', '--yes', '--json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-tier production access');
  });

  it('rejects storage:setup:prod mutation without secret-tier acknowledgment', () => {
    const result = runTsxScript(['scripts/setup-storage-prod.ts', '--yes', '--json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret-tier production access');
  });

  it('prints help for aws:destroy:all', () => {
    const result = runTsxScript(['scripts/aws-destroy-all.ts', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm run aws:destroy:all');
  });

  it('prints help for deploy:doctor', () => {
    const result = runTsxScript(['scripts/deploy-doctor.ts', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm run deploy:doctor');
  });

  it('prints help for e2e:provision', () => {
    const result = runTsxScript(['scripts/e2e-provision.ts', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: pnpm run e2e:provision');
  });
});
