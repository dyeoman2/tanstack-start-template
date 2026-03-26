import type { DeployDoctorCheck } from './deploy-doctor-checks';

export type StrictReadinessState = 'failed' | 'needs attention' | 'ready' | 'skipped';

export function normalizeStrictReadiness(
  value: string | undefined,
  fallback: StrictReadinessState = 'needs attention',
): StrictReadinessState {
  switch (value) {
    case 'ready':
    case 'skipped':
    case 'needs attention':
    case 'failed':
      return value;
    default:
      return fallback;
  }
}

export function hasFailedDeployDoctorChecks(checks: readonly DeployDoctorCheck[]): boolean {
  return checks.some((check) => check.status === 'fail');
}

export function summarizeFailedDeployDoctorChecks(checks: readonly DeployDoctorCheck[]): string[] {
  return checks
    .filter((check) => check.status === 'fail')
    .map((check) => (check.detail ? `${check.check}: ${check.detail}` : check.check));
}

export function normalizeSetupProdReadinessMap(
  readiness: Record<string, string | undefined>,
): Record<string, StrictReadinessState> {
  return Object.fromEntries(
    Object.entries(readiness).map(([key, value]) => [
      key,
      normalizeStrictReadiness(value, key === 'validation' ? 'failed' : 'needs attention'),
    ]),
  ) as Record<string, StrictReadinessState>;
}

export function filterSetupProdNextCommands(input: {
  nextCommands: string[];
  readiness: Record<string, StrictReadinessState>;
}): string[] {
  return input.nextCommands.filter((command) => {
    if (command === 'pnpm run deploy:doctor -- --prod') {
      return input.readiness.validation !== 'ready';
    }
    if (command.startsWith('pnpm run storage:setup:prod')) {
      return input.readiness.storage !== 'ready';
    }
    if (command.startsWith('pnpm run audit-archive:setup -- --prod')) {
      return input.readiness.auditArchive !== 'ready' && input.readiness.auditArchive !== 'skipped';
    }
    if (command.startsWith('pnpm run dr:setup')) {
      return input.readiness.dr !== 'ready' && input.readiness.dr !== 'skipped';
    }
    return true;
  });
}
