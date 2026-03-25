import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const convexRoot = path.join(repoRoot, 'convex');
const IGNORED_FILES = new Set([
  path.join(convexRoot, 'e2e.ts'),
  path.join(convexRoot, 'migrations.ts'),
]);

function listTsFiles(dirPath) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (
      entry.name === '_generated' ||
      entry.name === '__tests__' ||
      entry.name === 'node_modules'
    ) {
      continue;
    }

    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(entryPath));
      continue;
    }

    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
      continue;
    }

    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      continue;
    }

    if (IGNORED_FILES.has(entryPath)) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function main() {
  const failures = [];
  const files = listTsFiles(convexRoot);
  const protectedTables = [
    'auditLedgerEvents',
    'auditLedgerState',
    'auditLedgerCheckpoints',
    'auditLedgerSeals',
    'auditLedgerImmutableExports',
  ];
  const tablePattern = protectedTables.map((table) => `['"\`]${table}['"\`]`).join('|');
  const directMutationPattern = new RegExp(
    `ctx\\.db\\.(delete|patch|replace)\\([\\s\\S]{0,220}?(?:${tablePattern})[\\s\\S]{0,120}?\\)`,
    'g',
  );

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8');
    let match = directMutationPattern.exec(source);

    while (match) {
      const relativePath = path.relative(repoRoot, filePath);
      const line = lineNumberAt(source, match.index);
      const table =
        protectedTables.find(
          (name) =>
            match?.[0].includes(`'${name}'`) ||
            match?.[0].includes(`"${name}"`) ||
            match?.[0].includes(`\`${name}\``),
        ) ?? 'protected audit ledger table';
      failures.push(
        `${relativePath}:${line} direct runtime mutation of ${table} detected via ctx.db.${match[1]}(...)`,
      );
      match = directMutationPattern.exec(source);
    }
  }

  if (failures.length > 0) {
    console.error('Audit log immutability guardrail violations found:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Audit log immutability guardrail check passed');
}

main();
