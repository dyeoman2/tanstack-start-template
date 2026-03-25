import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve(import.meta.dirname, 'check-audit-log-immutability.mjs');

const tempDirs: string[] = [];

function createTempRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-immutability-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'convex'), { recursive: true });
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe('check-audit-log-immutability', () => {
  it('fails on direct mutation of protected audit ledger tables', () => {
    const repoRoot = createTempRepo();
    writeFileSync(
      path.join(repoRoot, 'convex', 'audit-bad.ts'),
      "export function bad(ctx, id) { return ctx.db.patch('auditLedgerEvents', { id }); }\n",
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('direct runtime mutation of auditLedgerEvents');
  });

  it('passes when audit ledger tables are only inserted into', () => {
    const repoRoot = createTempRepo();
    writeFileSync(
      path.join(repoRoot, 'convex', 'audit-good.ts'),
      "export function good(ctx, row) { return ctx.db.insert('auditLedgerEvents', row); }\n",
    );

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Audit log immutability guardrail check passed');
  });
});
