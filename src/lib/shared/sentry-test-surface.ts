export function isSentryTestSurfaceEnabled() {
  const isNodeTestRuntime =
    typeof process !== 'undefined' &&
    (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');

  return import.meta.env.DEV || import.meta.env.MODE === 'test' || isNodeTestRuntime;
}
