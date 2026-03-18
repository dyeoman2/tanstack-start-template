import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type ConvexFunctionKind =
  | 'query'
  | 'mutation'
  | 'action'
  | 'internalQuery'
  | 'internalMutation'
  | 'internalAction'
  | 'httpAction';

export type AuthClassification =
  | 'internal'
  | 'http'
  | 'builder-protected'
  | 'explicit-helper-protected'
  | 'allowlisted-public'
  | 'unprotected';

export type ConvexFunctionRecord = {
  block: string;
  creator: string;
  file: string;
  hasReturns: boolean;
  kind: ConvexFunctionKind | 'custom';
  name: string;
};

type ClassifiedRecord = ConvexFunctionRecord & {
  classification: AuthClassification;
  reason: string;
};

const ROOT = process.cwd();
const CONVEX_DIR = path.join(ROOT, 'convex');
const FUNCTION_PATTERN =
  /export const (\w+) =\s*(query|mutation|action|internalQuery|internalMutation|internalAction|httpAction|\w+)\s*\(/g;

const PUBLIC_FUNCTION_KINDS = new Set<ConvexFunctionKind>(['query', 'mutation', 'action']);
const INTERNAL_FUNCTION_KINDS = new Set<ConvexFunctionKind>([
  'internalQuery',
  'internalMutation',
  'internalAction',
]);
const BUILDER_CREATORS = new Set([
  'organizationQuery',
  'organizationMutation',
  'organizationAdminMutation',
  'optionalOrganizationQuery',
  'siteAdminQuery',
  'siteAdminMutation',
  'siteAdminAction',
]);
const APPROVED_HELPER_PATTERNS = [
  /\bgetVerifiedCurrentUserOrThrow\s*\(/,
  /\bgetVerifiedCurrentAuthUserOrNull\s*\(/,
  /\bgetCurrentUserOrNull\s*\(/,
  /\bgetCurrentAuthUserOrThrow\s*\(/,
  /\bgetCurrentAuthUserOrNull\s*\(/,
  /\bgetVerifiedCurrentUserFromActionOrThrow\s*\(/,
  /\bgetVerifiedCurrentSiteAdminUserOrThrow\s*\(/,
  /\bgetVerifiedCurrentSiteAdminUserFromActionOrThrow\s*\(/,
  /\bgetOrganizationAccessContextBySlug\s*\(/,
  /\bgetOrganizationAccessContextById\s*\(/,
  /\brequireSiteAdmin\s*\(/,
  /\brequireOrganizationPermission\s*\(/,
  /\brequireOrganizationPermissionFromActionOrThrow\s*\(/,
  /\brequireStorageReadAccessFromActionOrThrow\s*\(/,
  /\brequireThreadPermission\s*\(/,
  /\bgetCurrentChatContext\s*\(/,
  /\bgetCurrentChatContextOrNull\s*\(/,
  /\bgetAuthenticatedContext\s*\(/,
  /\bcanUserSelfServeCreateOrganization\s*\(/,
  /\bassertScimManagementAccess\s*\(/,
  /\bresolveEnterpriseSessionContext\s*\(/,
  /\bauthComponent\.getAuthUser\s*\(/,
  /\brunBetterAuthAction\s*\(/,
  /\bassertOrganizationSettingsWriteAccess\s*\(/,
  /\bchangeOrganizationMemberStatus\s*\(/,
];
const AUTH_ALLOWLIST: Record<string, string> = {
  'convex/auth.ts:enforcePdfParseRateLimit':
    'Authenticated self-rate-limit endpoint used by PDF parsing flows.',
  'convex/auth.ts:getCurrentUser':
    'Returns the current Better Auth user or null for session hydration.',
  'convex/emails.ts:checkEmailServiceConfigured':
    'Public capability check used to decide whether auth email flows are enabled.',
  'convex/playground.ts:playground':
    'Agent playground API registration is intentionally public and not a standard Convex function builder.',
  'convex/users.ts:getUserCount': 'Bootstrap helper used to detect first-user setup state.',
  'convex/auth/access.ts:resolveOrganizationPermissionById':
    'Public permission-check endpoint used to evaluate organization access decisions.',
  'convex/auth/access.ts:resolveOrganizationPermissionBySlug':
    'Public permission-check endpoint used to evaluate organization access decisions.',
  'convex/organizationManagement.ts:getOrganizationEnterpriseAuthSettings':
    'Read-only wrapper around guarded organization settings query for enterprise auth screens.',
  'convex/organizationManagement.ts:resolveOrganizationEnterpriseAuthByEmail':
    'Public sign-in discovery endpoint used before authentication is established.',
  'convex/users.ts:ensureCurrentUserContext':
    'Authenticated bootstrap action that hydrates the current user context after login.',
  'convex/auth.ts:resolvePasswordResetEmail':
    'Password-reset bridge action used after token verification during reset completion.',
  'convex/agentChat.ts:generateChatAttachmentUploadTarget':
    'Uses the internal current-chat context gate before issuing upload targets.',
  'convex/agentChat.ts:deletePersona':
    'Uses the internal current-chat context gate and persona ownership checks.',
  'convex/organizationDomains.ts:verifyOrganizationDomain':
    'Delegates to a guarded verification handler that validates organization membership.',
  'convex/security.ts:getSecurityPostureSummary':
    'Delegates to a site-admin-only handler for security posture data.',
  'convex/security.ts:listSecurityControlEvidenceActivity':
    'Delegates to a site-admin-only handler for evidence activity data.',
  'convex/security.ts:renewSecurityControlEvidence':
    'Delegates to a site-admin-only renewal handler for evidence records.',
  'convex/security.ts:exportEvidenceReport':
    'Delegates to a site-admin-only export handler for evidence reports.',
  'convex/security.ts:generateEvidenceReport':
    'Delegates to a site-admin-only generation handler for evidence reports.',
  'convex/security.ts:reseedSecurityControlWorkspaceForDevelopment':
    'Development-only reseed endpoint protected by the e2e shared secret.',
};

function isConvexSourceFile(filePath: string) {
  return (
    filePath.endsWith('.ts') &&
    !filePath.includes(`${path.sep}_generated${path.sep}`) &&
    !filePath.includes(`${path.sep}betterAuth${path.sep}_generated${path.sep}`)
  );
}

function listConvexFiles(dir: string = CONVEX_DIR): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listConvexFiles(fullPath);
    }

    return isConvexSourceFile(fullPath) ? [fullPath] : [];
  });
}

export function scanConvexFunctionsFromSource(
  source: string,
  relativeFilePath: string,
): ConvexFunctionRecord[] {
  const matches = [...source.matchAll(FUNCTION_PATTERN)];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? source.length;
    const block = source.slice(start, next);
    const creator = match[2] ?? 'unknown';
    const kind = (
      PUBLIC_FUNCTION_KINDS.has(creator as ConvexFunctionKind) ||
      INTERNAL_FUNCTION_KINDS.has(creator as ConvexFunctionKind) ||
      creator === 'httpAction'
        ? creator
        : 'custom'
    ) as ConvexFunctionRecord['kind'];

    return {
      block,
      creator,
      file: relativeFilePath,
      name: match[1] ?? 'unknown',
      kind,
      hasReturns:
        kind === 'httpAction' || creator === 'definePlaygroundAPI'
          ? true
          : /\breturns\s*:/.test(block),
    };
  });
}

function scanConvexFunctions(filePath: string): ConvexFunctionRecord[] {
  const source = fs.readFileSync(filePath, 'utf8');
  return scanConvexFunctionsFromSource(source, path.relative(ROOT, filePath));
}

export function classifyConvexFunction(record: ConvexFunctionRecord): ClassifiedRecord {
  const allowlistKey = `${record.file}:${record.name}`;

  if (record.kind !== 'custom' && INTERNAL_FUNCTION_KINDS.has(record.kind)) {
    return {
      ...record,
      classification: 'internal',
      reason: 'Convex internal function.',
    };
  }

  if (record.kind === 'httpAction') {
    return {
      ...record,
      classification: 'http',
      reason: 'HTTP actions are audited separately.',
    };
  }

  if (BUILDER_CREATORS.has(record.creator)) {
    return {
      ...record,
      classification: 'builder-protected',
      reason: `Uses approved auth wrapper ${record.creator}.`,
    };
  }

  if (AUTH_ALLOWLIST[allowlistKey]) {
    return {
      ...record,
      classification: 'allowlisted-public',
      reason: AUTH_ALLOWLIST[allowlistKey],
    };
  }

  if (
    (record.kind === 'custom' || PUBLIC_FUNCTION_KINDS.has(record.kind)) &&
    APPROVED_HELPER_PATTERNS.some((pattern) => pattern.test(record.block))
  ) {
    return {
      ...record,
      classification: 'explicit-helper-protected',
      reason: 'Uses an approved auth helper near the handler entrypoint.',
    };
  }

  return {
    ...record,
    classification: 'unprotected',
    reason: 'Public Convex function is not wrapped and does not call an approved auth helper.',
  };
}

function collectInventory() {
  return listConvexFiles().sort().flatMap(scanConvexFunctions);
}

function printInventory(records: ClassifiedRecord[]) {
  for (const record of records) {
    console.log(
      `${record.file}:${record.name} [${record.kind}] ${record.classification} - ${record.reason}`,
    );
  }
}

function checkReturns(records: ClassifiedRecord[]) {
  const missing = records.filter((record) => !record.hasReturns);
  if (missing.length === 0) {
    return true;
  }

  console.error(
    `Missing returns on ${missing.length} exported Convex functions out of ${records.length}.`,
  );

  for (const record of missing) {
    console.error(`- ${record.file}: ${record.name} (${record.creator})`);
  }

  return false;
}

function checkProtection(records: ClassifiedRecord[]) {
  const unprotected = records.filter((record) => record.classification === 'unprotected');
  if (unprotected.length === 0) {
    return true;
  }

  console.error(`Found ${unprotected.length} unprotected public Convex functions.`);
  for (const record of unprotected) {
    console.error(`- ${record.file}:${record.name} (${record.creator})`);
  }

  return false;
}

function runCli(command: string) {
  const records = collectInventory().map(classifyConvexFunction);

  if (command === 'inventory') {
    printInventory(records);
    return;
  }

  if (command === 'check') {
    const returnsOk = checkReturns(records);
    const protectionOk = checkProtection(records);

    if (returnsOk && protectionOk) {
      console.log(
        `All ${records.length} exported Convex functions define returns and satisfy auth guardrails.`,
      );
      return;
    }

    process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl === import.meta.url) {
  runCli(process.argv[2] ?? 'check');
}
