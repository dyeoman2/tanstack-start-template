export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} environment variable is required for Playwright E2E`);
  }

  return value;
}
