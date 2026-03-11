function sanitizeRunId(value: string) {
  return value.replace(/[^a-zA-Z0-9-]/g, '-');
}

const rawRunId =
  process.env.CI_RUN_ID ||
  process.env.GITHUB_RUN_ID ||
  process.env.BUILD_ID ||
  process.env.PLAYWRIGHT_E2E_RUN_ID ||
  'local';

export const E2E_RUN_ID = sanitizeRunId(rawRunId);

export function createScopedValue(base: string) {
  return `e2e-${E2E_RUN_ID}-${base}`;
}
