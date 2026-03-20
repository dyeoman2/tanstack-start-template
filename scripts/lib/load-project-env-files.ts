import { existsSync } from 'node:fs';
import path from 'node:path';

export type LoadProjectEnvFilesOptions = {
  cwd?: string;
  /** Loaded after `.env` and `.env.local`; later files override earlier. */
  extraFilenames?: string[];
};

/**
 * Merges project env files into `process.env` using Node’s `process.loadEnvFile` when available.
 *
 * Order: `.env` → `.env.local` → `extraFilenames`. Same pattern as Vite/typical local tooling.
 * DR scripts pass `extraFilenames: ['.dr.env.local']` so DR vars can override without touching `.env.local`.
 */
export function loadProjectEnvFiles(options?: LoadProjectEnvFilesOptions): void {
  const loadEnvFile = process.loadEnvFile?.bind(process);
  if (!loadEnvFile) {
    return;
  }

  const cwd = options?.cwd ?? process.cwd();
  const names = ['.env', '.env.local', ...(options?.extraFilenames ?? [])];
  for (const fileName of names) {
    const filePath = path.join(cwd, fileName);
    if (existsSync(filePath)) {
      loadEnvFile(filePath);
    }
  }
}
