import { describe, expect, it } from 'vitest';
import {
  filterSetupProdNextCommands,
  hasFailedDeployDoctorChecks,
  normalizeStrictReadiness,
  normalizeSetupProdReadinessMap,
  summarizeFailedDeployDoctorChecks,
} from './setup-prod-gate';

describe('setup prod gate helpers', () => {
  it('normalizes legacy soft readiness to needs attention', () => {
    expect(normalizeStrictReadiness('configured in follow-up flow')).toBe('needs attention');
  });

  it('preserves strict readiness states', () => {
    expect(normalizeStrictReadiness('ready')).toBe('ready');
    expect(normalizeStrictReadiness('skipped')).toBe('skipped');
    expect(normalizeStrictReadiness('failed')).toBe('failed');
  });

  it('detects failed deploy doctor checks', () => {
    expect(
      hasFailedDeployDoctorChecks([
        { check: 'A', status: 'pass' },
        { check: 'B', status: 'fail', detail: 'missing env' },
      ]),
    ).toBe(true);
  });

  it('summarizes failed deploy doctor checks', () => {
    expect(
      summarizeFailedDeployDoctorChecks([
        { check: 'Storage runtime', status: 'fail', detail: 'missing STORAGE_BROKER_URL' },
      ]),
    ).toEqual(['Storage runtime: missing STORAGE_BROKER_URL']);
  });

  it('normalizes setup:prod readiness map to strict states', () => {
    expect(
      normalizeSetupProdReadinessMap({
        auditArchive: 'skipped',
        storage: 'ready',
        validation: 'pending',
      }),
    ).toEqual({
      auditArchive: 'skipped',
      storage: 'ready',
      validation: 'failed',
    });
  });

  it('filters resolved follow-up commands out of setup:prod output', () => {
    expect(
      filterSetupProdNextCommands({
        nextCommands: [
          'pnpm run deploy:doctor -- --prod',
          'pnpm run storage:setup:prod',
          'pnpm run audit-archive:setup -- --prod',
          'pnpm run dr:setup',
          'pnpm run setup:github-deploy',
        ],
        readiness: {
          auditArchive: 'skipped',
          dr: 'skipped',
          storage: 'ready',
          validation: 'failed',
        },
      }),
    ).toEqual(['pnpm run deploy:doctor -- --prod', 'pnpm run setup:github-deploy']);
  });
});
