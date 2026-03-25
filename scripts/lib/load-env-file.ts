import { existsSync, readFileSync } from 'node:fs';

export function loadOptionalEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const loadEnvFile = process.loadEnvFile?.bind(process);
  if (loadEnvFile) {
    try {
      loadEnvFile(filePath);
      return;
    } catch {
      // Fall back to manual parsing.
    }
  }

  const envContent = readFileSync(filePath, 'utf8');
  for (const line of envContent.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const firstEquals = trimmed.indexOf('=');
    if (firstEquals <= 0) {
      continue;
    }

    const key = trimmed.slice(0, firstEquals).trim();
    const rawValue = trimmed.slice(firstEquals + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
