import fs from 'node:fs';
import path from 'node:path';

type ConvexFunctionRecord = {
  file: string;
  name: string;
  kind: string;
  hasReturns: boolean;
};

const ROOT = process.cwd();
const CONVEX_DIR = path.join(ROOT, 'convex');
const FUNCTION_PATTERN =
  /export const (\w+) = (query|mutation|action|internalQuery|internalMutation|internalAction|httpAction)\(/g;

function listConvexFiles() {
  return fs
    .readdirSync(CONVEX_DIR)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()
    .map((entry) => path.join(CONVEX_DIR, entry));
}

function scanConvexFunctions(filePath: string): ConvexFunctionRecord[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const matches = [...source.matchAll(FUNCTION_PATTERN)];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? source.length;
    const block = source.slice(start, next);
    const kind = match[2] ?? 'unknown';

    return {
      file: path.relative(ROOT, filePath),
      name: match[1] ?? 'unknown',
      kind,
      hasReturns: kind === 'httpAction' ? true : /\breturns\s*:/.test(block),
    };
  });
}

function collectInventory() {
  return listConvexFiles().flatMap(scanConvexFunctions);
}

function printInventory(records: ConvexFunctionRecord[]) {
  const byFile = new Map<string, { total: number; missing: number }>();

  for (const record of records) {
    const entry = byFile.get(record.file) ?? { total: 0, missing: 0 };
    entry.total += 1;
    if (!record.hasReturns) {
      entry.missing += 1;
    }
    byFile.set(record.file, entry);
  }

  for (const [file, counts] of [...byFile.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(`${file}: ${counts.total} functions, ${counts.missing} missing returns`);
  }
}

function checkReturns(records: ConvexFunctionRecord[]) {
  const missing = records.filter((record) => !record.hasReturns);

  if (missing.length === 0) {
    console.log(`All ${records.length} exported Convex functions define returns.`);
    return;
  }

  console.error(
    `Missing returns on ${missing.length} exported Convex functions out of ${records.length}.`,
  );

  for (const record of missing) {
    console.error(`- ${record.file}: ${record.name} (${record.kind})`);
  }

  process.exitCode = 1;
}

const command = process.argv[2] ?? 'check';
const records = collectInventory();

if (command === 'inventory') {
  printInventory(records);
} else if (command === 'check') {
  checkReturns(records);
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
