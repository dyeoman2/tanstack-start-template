import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const convexRoot = path.join(repoRoot, 'convex');

const HIGH_RISK_ADMIN_EVENTS = new Map([
  [
    'enterprise_scim_token_generated',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'enterprise_scim_token_deleted',
    [
      'actorUserId',
      'organizationId',
      'outcome',
      'resourceType',
      'resourceId',
      'severity',
      'sourceSurface',
    ],
  ],
  [
    'evidence_report_generated',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_exported',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
  [
    'evidence_report_reviewed',
    ['actorUserId', 'outcome', 'resourceType', 'resourceId', 'severity', 'sourceSurface'],
  ],
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

    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      files.push(entryPath);
    }
  }

  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function extractInsertAuditLogCalls(source) {
  const calls = [];
  const callRegex = /runMutation\(\s*(?:anyApi|internal)\.audit\.insertAuditLog\s*,\s*\{/g;
  let match = callRegex.exec(source);

  while (match) {
    const start = match.index;
    let index = start + match[0].length;
    let depth = 1;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      index += 1;
    }

    if (depth === 0) {
      calls.push({
        snippet: source.slice(start, index),
        start,
      });
    }

    match = callRegex.exec(source);
  }

  return calls;
}

function main() {
  const failures = [];
  const files = listTsFiles(convexRoot);

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf8');
    const calls = extractInsertAuditLogCalls(source);

    for (const call of calls) {
      const eventTypeMatch = call.snippet.match(/eventType:\s*['"]([^'"]+)['"]/);
      const eventType = eventTypeMatch?.[1];
      if (!eventType || !HIGH_RISK_ADMIN_EVENTS.has(eventType)) {
        continue;
      }

      const requiredFields = HIGH_RISK_ADMIN_EVENTS.get(eventType) ?? [];
      const missingFields = requiredFields.filter(
        (field) => !new RegExp(`\\b${field}\\s*:`).test(call.snippet),
      );

      if (missingFields.length === 0) {
        continue;
      }

      const relativePath = path.relative(repoRoot, filePath);
      const line = lineNumberAt(source, call.start);
      failures.push(
        `${relativePath}:${line} ${eventType} is missing required audit fields: ${missingFields.join(', ')}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('Admin audit guardrail violations found:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Admin audit guardrail check passed');
}

main();
