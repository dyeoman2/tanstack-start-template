import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAwsDestroyAllSteps } from './aws-destroy-all';

const repoRoot = path.resolve(import.meta.dirname, '..');

describe('aws:destroy:all', () => {
  it('orchestrates teardown in the safe order', () => {
    expect(buildAwsDestroyAllSteps(false)).toEqual([
      {
        args: ['run', 'dr:destroy', '--', '--stack', 'all'],
        command: 'pnpm run dr:destroy -- --stack all',
        label: 'DR teardown',
      },
      {
        args: ['run', 'storage:destroy:prod'],
        command: 'pnpm run storage:destroy:prod',
        label: 'prod storage teardown',
      },
      {
        args: ['run', 'storage:destroy:dev'],
        command: 'pnpm run storage:destroy:dev',
        label: 'dev storage teardown',
      },
      {
        args: ['run', 'audit-archive:destroy'],
        command: 'pnpm run audit-archive:destroy',
        label: 'audit archive teardown',
      },
    ]);
  });

  it('passes through --yes to child teardown commands', () => {
    expect(buildAwsDestroyAllSteps(true)).toEqual([
      {
        args: ['run', 'dr:destroy', '--', '--stack', 'all', '--yes'],
        command: 'pnpm run dr:destroy -- --stack all --yes',
        label: 'DR teardown',
      },
      {
        args: ['run', 'storage:destroy:prod', '--', '--yes'],
        command: 'pnpm run storage:destroy:prod -- --yes',
        label: 'prod storage teardown',
      },
      {
        args: ['run', 'storage:destroy:dev', '--', '--yes'],
        command: 'pnpm run storage:destroy:dev -- --yes',
        label: 'dev storage teardown',
      },
      {
        args: ['run', 'audit-archive:destroy', '--', '--yes'],
        command: 'pnpm run audit-archive:destroy -- --yes',
        label: 'audit archive teardown',
      },
    ]);
  });

  it('keeps the documented destroy command surface aligned', () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const commandMap = readFileSync(path.join(repoRoot, 'docs', 'SCRIPT_COMMAND_MAP.md'), 'utf8');

    expect(packageJson.scripts['storage:destroy:dev']).toBeDefined();
    expect(packageJson.scripts['storage:destroy:prod']).toBeDefined();
    expect(packageJson.scripts['audit-archive:destroy']).toBeDefined();
    expect(packageJson.scripts['dr:destroy']).toBeDefined();
    expect(packageJson.scripts['aws:destroy:all']).toBeDefined();

    expect(commandMap).toContain('`pnpm run storage:destroy:dev`');
    expect(commandMap).toContain('`pnpm run storage:destroy:prod`');
    expect(commandMap).toContain('`pnpm run audit-archive:destroy`');
    expect(commandMap).toContain('`pnpm run dr:destroy -- --stack all`');
    expect(commandMap).toContain('`pnpm run aws:destroy:all`');
  });
});
