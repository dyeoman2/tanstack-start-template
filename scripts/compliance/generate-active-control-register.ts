import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ModerateControl = {
  familyId: string;
  familyTitle: string;
  nist80053Id: string;
  statement: string[];
  title: string;
};

type ModerateControlsPayload = {
  controls: ModerateControl[];
  sourcePath: string;
};

type HipaaCitation = {
  citation: string;
  implementationSpecification: 'required' | 'addressable' | null;
  title: string;
  type: 'clause' | 'implementation_specification' | 'section' | 'standard' | 'subsection';
};

type HipaaPayload = {
  citations: HipaaCitation[];
  sourcePath: string;
};

type CsfIndexEntry = {
  categoryId: string;
  categoryTitle: string;
  functionId: string;
  functionTitle: string;
  subcategoryId: string;
  subcategoryTitle: string;
};

type CsfPayload = {
  functions?: Array<{
    categories?: Array<{
      subcategories?: Array<{
        categoryId?: string;
        categoryTitle?: string;
        functionId?: string;
        functionTitle?: string;
        id?: string;
        informativeReferences?: Array<{ framework: string; reference: string }>;
        title?: string;
      }>;
    }>;
  }>;
  indexes?: {
    nist80053?: Record<string, CsfIndexEntry[]>;
  };
  sourcePath?: string;
};

type Nist80066Citation = {
  citation: string;
  keyActivities: Array<{
    elementType: string;
    referenceId: string;
    text: string;
    title: string;
  }>;
  publicationCrosswalks: Array<{
    elementType: string;
    referenceId: string;
    text: string;
    title: string;
  }>;
  referenceId: string;
  sampleQuestions: Array<{
    elementType: string;
    referenceId: string;
    text: string;
    title: string;
  }>;
  text: string;
  title: string;
};

type Nist80066Payload = {
  citationCount: number;
  citations: Nist80066Citation[];
  sourcePath: string;
};

type Soc2TrustServiceCategory =
  | 'availability'
  | 'confidentiality'
  | 'privacy'
  | 'processing-integrity'
  | 'security';

type Soc2CriterionGroup =
  | 'availability'
  | 'common-criteria'
  | 'confidentiality'
  | 'privacy'
  | 'processing-integrity';

type Soc2IndexEntry = {
  criterionId: string;
  group: Soc2CriterionGroup;
  title: string;
  trustServiceCategory: Soc2TrustServiceCategory;
};

type Soc2Payload = {
  indexes?: {
    nist80053?: Record<string, Soc2IndexEntry[]>;
  };
  sourceFiles: string[];
};

type Coverage = 'covered' | 'not-applicable' | 'not-covered' | 'partial';
type Responsibility = 'customer' | 'platform' | 'shared-responsibility' | null;
type ChecklistEvidenceType = 'file' | 'link' | 'note' | 'system';
type ChecklistStatus = 'done' | 'in_progress' | 'not_applicable' | 'not_started';
type ChecklistEvidenceSufficiency = 'missing' | 'partial' | 'sufficient';
type SeededChecklistEvidenceType = 'link' | 'note' | 'system_snapshot';

const MODERATE_CONTROLS_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/nist-800-53-moderate-controls.json',
);
const HIPAA_MAPPINGS_PATH = path.resolve(
  process.cwd(),
  'compliance/mappings/hipaa-security-rule-citations.json',
);
const CSF_REFERENCES_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/csf-2.0-informative-references.json',
);
const NIST_80066_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/nist-800-66-controls.json',
);
const SOC2_TSC_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/soc-2-trust-services-criteria.json',
);
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/active-control-register.seed.json',
);

function seededEvidence(
  title: string,
  description: string,
  options?: {
    evidenceType?: SeededChecklistEvidenceType;
    sufficiency?: ChecklistEvidenceSufficiency;
    url?: string | null;
  },
) {
  return {
    title,
    description,
    evidenceType: options?.evidenceType ?? 'note',
    sufficiency: options?.sufficiency ?? 'sufficient',
    url: options?.url ?? null,
  };
}

function seededChecklist(
  status: ChecklistStatus,
  notes: string,
  evidence: ReturnType<typeof seededEvidence>[],
  owner = 'Identity and Access Management',
) {
  return {
    status,
    owner,
    notes,
    evidence,
  };
}

const CHECKLIST_LABEL_REWRITES = new Map<string, string>([
  [
    'Site admin security posture surfaces can support provider awareness walkthroughs',
    'Site admin security posture can support provider security awareness reviews',
  ],
  [
    'Provider-facing audit review surfaces exist',
    'Authorized security administrators can review audit activity and related evidence',
  ],
  [
    'Baseline posture can be reviewed in provider and tenant surfaces',
    'Baseline posture can be reviewed in provider and tenant interfaces',
  ],
]);

const CHECKLIST_DESCRIPTION_REWRITES = new Map<string, string>([
  [
    'The platform must provide supported surfaces for reviewing audit activity and related security evidence.',
    'The platform provides authorized security administrators with a supported administrative interface for reviewing audit activity, control records, and related security evidence.',
  ],
]);

const EVIDENCE_TITLE_REWRITES = new Map<string, string>([
  ['Security admin audit review surface', 'Administrative security audit review route'],
  ['Security admin review surface', 'Administrative security review route'],
  ['Site admin security posture UI', 'Site admin security posture interface'],
  ['Organization audit review surface', 'Organization audit review interface'],
  ['Evidence report review storage', 'Evidence report review record structure'],
  ['Evidence report review-state schema', 'Evidence report review record structure'],
  ['Model catalog editing surface', 'Model catalog review interface'],
  ['Vendor posture site admin UI', 'Site admin vendor posture interface'],
]);

const EVIDENCE_DESCRIPTION_REWRITES = new Map<string, string>([
  [
    'Administrative security audit review route',
    'Administrative security route showing recent security signals and linked evidence available for authorized administrative review.',
  ],
  [
    'Administrative security review route',
    'Administrative security route showing the control workspace, audit review records, and evidence review actions available to authorized security administrators.',
  ],
  [
    'Organization audit review interface',
    'Organization audit review interface showing membership lifecycle and related audit history available to authorized organization administrators and site admins.',
  ],
  [
    'Organization access policy controls',
    'Organization policy controls showing invitation policy, verified-domain restrictions, member-cap settings, and the related management interface.',
  ],
  [
    'Authenticated access guardrails',
    'Authentication guardrails showing protected access checks and authenticated user context resolution for server-side authorization.',
  ],
  [
    'Auth runtime session handling',
    'Authentication runtime configuration showing the session handling and plugin protections used for authenticated access.',
  ],
  [
    'Verified email enforcement',
    'Verified-email enforcement showing protected access restrictions for unverified accounts and the verified-email requirement applied by default.',
  ],
  [
    'Regulated MFA baseline',
    'Regulated MFA baseline showing required MFA or passkey protections for regulated organizations and the related policy posture presented to administrators.',
  ],
  [
    'Recent step-up protections',
    'Recent step-up protections showing step-up requirements for audit exports and fresh-session redirects for sensitive actions.',
  ],
  [
    'MFA and fresh-session enforcement',
    'Authentication enforcement showing MFA, passkey, and fresh-session requirements before privileged or regulated access proceeds.',
  ],
  [
    'Evidence report review workflow',
    'Review workflow for recording evidence report status, reviewer notes, and follow-up actions.',
  ],
  [
    'Evidence report review record structure',
    'Evidence report schema and retained review metadata, including review status, reviewer identity, review timestamps, review notes, content hash, and export integrity fields.',
  ],
  [
    'Evidence report generation action',
    'Evidence report generation workflow producing structured evidence reports from current posture, audit activity, integrity checks, and control workspace data.',
  ],
  [
    'Site admin report generation interface',
    'Site admin interface showing evidence report and audit readiness report actions for current control and posture data.',
  ],
  [
    'Control matrix operational evidence note',
    'Control matrix documentation describing evidence report generation as a source of structured evidence snapshots for compliance-ready exports.',
  ],
  [
    'Site admin review workflow',
    'Site admin review workflow for recording evidence report status, reviewer attribution, reviewer notes, and follow-up actions.',
  ],
  [
    'Site admin export interface',
    'Site admin interface showing export actions and displayed content and export hashes for evidence reports.',
  ],
  [
    'Audit readiness report generation',
    'Audit readiness report action showing current manifest, denial, metadata-gap, and restore-drill evidence included in readiness output.',
  ],
  [
    'Operational evidence summary',
    'Operational evidence summary showing backup verification as part of the site admin security workspace evidence set.',
  ],
  [
    'Signed release bundle workflow',
    'Workflow for creating and verifying a signed source bundle artifact set for later review.',
  ],
  [
    'Release provenance record workflow',
    'Workflow for retaining release run metadata, signed source bundle hash, deployment outcome, and production DAST result as linked release evidence.',
  ],
  [
    'Release verification workflow',
    'Workflow for waiting on the target deployment, running post-deploy smoke checks, and running an OWASP ZAP baseline before final release evidence is recorded.',
  ],
  [
    'Release security validation workflow',
    'Workflow for running production dependency audit, Semgrep, OSV scanning, security boundary checks, and SBOM generation before deployment proceeds.',
  ],
  [
    'Operational evidence note',
    'Control matrix documentation describing retained operational evidence available for provider review.',
  ],
  [
    'Restore drill audit events',
    'Audit event inventory listing restore-drill completion and failure events recorded when verification results are stored.',
  ],
  [
    'Backup verification write path',
    'Workflow for recording backup verification and restore-drill evidence for later provider review.',
  ],
  [
    'Evidence report interface workflow',
    'Interface showing evidence report generation, review, and export actions available from current monitoring state.',
  ],
  [
    'Evidence report generation and export',
    'Evidence report workflow generating structured exports containing posture, audit, review, and integrity data for reviewer use.',
  ],
  [
    'Evidence report export action',
    'Evidence report export workflow packaging report content, manifest data, and integrity metadata for reviewer distribution.',
  ],
  [
    'Site admin evidence and readiness actions',
    'Site admin interface showing evidence report and audit readiness actions available for investigation and planning artifacts.',
  ],
  [
    'Evidence export support',
    'Evidence report workflow generating and exporting structured artifacts that can be reviewed during investigations.',
  ],
  [
    'Integrity-linked evidence report metadata',
    'Evidence report schema and retained integrity metadata, including content hash, export hash, export integrity summary, and review metadata.',
  ],
  [
    'Generated investigation-supporting exports',
    'Generated exports containing posture, audit, review, and integrity metadata that can be reused during investigations and exercises.',
  ],
  [
    'Evidence report review interface',
    'Administrative security interface showing report status, review notes, and export metadata associated with incident-supporting artifacts.',
  ],
  [
    'Auth security guidance',
    'Auth security documentation describing privileged-access expectations, trusted-origin requirements, and deployer-owned security gaps.',
  ],
  [
    'Auth security baseline notes',
    'Auth security documentation describing strict authentication defaults, session protections, origin validation, and deployer-owned security gaps.',
  ],
  [
    'Operational readiness note',
    'Control matrix documentation describing internal operational evidence and deployer-owned gaps surfaced in the site admin security workspace.',
  ],
  [
    'Runtime vendor posture snapshot',
    'Vendor posture snapshot showing approval status, allowed data classes, and environment restrictions for configured external services.',
  ],
  [
    'Vendor boundary posture materialization',
    'Vendor boundary posture data showing current approval state, allowed data classes, and environment restrictions for configured external services.',
  ],
  [
    'Vendor use and denial event emission',
    'Audit event inventory listing vendor-use and vendor-denial events recorded during protected vendor-backed workflows.',
  ],
  [
    'Attachment inspection audit events',
    'Audit event inventory listing attachment inspection events for passed, failed, and quarantined files.',
  ],
  [
    'Audit event inventory',
    'Audit event inventory listing the security-relevant event types captured for authentication, administrative, organization, evidence, and file-handling activity.',
  ],
  [
    'Attachment scan event recording',
    'Document scan event records retained for inspected attachments before downstream workflows continue.',
  ],
  [
    'Structured audit record insertion',
    'Audit record schema retaining event type, actor, resource metadata, and serialized event metadata for later review.',
  ],
  [
    'Client audit event action',
    'Client-triggered audit event action available for authenticated audit record creation.',
  ],
  [
    'Backend audit insertion',
    'Backend audit insertion workflow used across protected server-side actions and mutations.',
  ],
  [
    'Authorized Convex builders',
    'Protected query, mutation, and action builders separating site admin and organization-scoped access paths.',
  ],
  [
    'Privileged server access guards',
    'Privileged server access guards showing authenticated-access and site-admin checks required before privileged server flows proceed.',
  ],
  [
    'MFA enforcement for site admin access',
    'Site admin access enforcement showing MFA or passkey requirements before privileged administrative access is granted.',
  ],
  [
    'Signed file serve URLs',
    'Signed file-serving URLs used for protected file access with HMAC-backed integrity validation.',
  ],
  [
    'Integrity-linked export workflow',
    'Export workflow generating bundles with content hashes and export hashes displayed for reviewer verification.',
  ],
  [
    'Restore verification data model',
    'Restore-verification schema and related audit events retained for backup drill and recovery review.',
  ],
  [
    'Backup verification record path',
    'Backup verification record workflow storing backup and restore verification outcomes for later provider review.',
  ],
  [
    'Auth-protected Convex builders',
    'Protected builder wrappers used for site admin and organization-scoped functions that require authenticated access.',
  ],
  [
    'Better Auth secret validation',
    'Authentication secret validation requiring the Better Auth secret and minimum secret expectations before auth starts outside tests.',
  ],
  [
    'Site admin evidence upload and review flows',
    'Site admin evidence workflow for attaching, reviewing, and exporting provider control artifacts.',
  ],
  [
    'Evidence review and export flows',
    'Evidence workflow for attaching, reviewing, and exporting provider control artifacts.',
  ],
  [
    'Model catalog review interface',
    'Model catalog interface showing deprecated status and update actions for curated managed models.',
  ],
  [
    'Code-health audit script',
    'Code-health audit script used to review exported Convex functions and related implementation risk conditions.',
  ],
  [
    'Audit chain verification action',
    'Audit integrity verification action that recomputes hash chains and records integrity failures for later review.',
  ],
  [
    'Evidence and vendor audit events',
    'Audit event inventory listing evidence-report and outbound-vendor events recorded for review of security workflows.',
  ],
  [
    'GuardDuty malware finding pipeline',
    'Malware-finding workflow showing S3 malware scanning, signed finding verification, and quarantine actions for affected files.',
  ],
  [
    'Malware finding persistence',
    'Malware-finding records retaining finding identifiers, malware status, and quarantine timestamps for containment and review.',
  ],
  [
    'Session transport configuration',
    'Session transport configuration showing secure cookie settings, session expiry values, fresh-session windows, and related transport protections.',
  ],
  [
    'Evidence report follow-up workflow',
    'Review workflow for recording follow-up status and reviewer notes on evidence reports.',
  ],
  [
    'Evidence activity storage and query path',
    'Evidence activity records and query path showing creation, review, archival, and renewal history by control and checklist item.',
  ],
  [
    'Storage signing secret validation',
    'Storage signing secret validation showing required signing-secret checks before protected file serving and webhook processing proceed.',
  ],
  [
    'Webhook signature verification',
    'Webhook signature verification flow showing signed GuardDuty payload validation before malware findings are accepted.',
  ],
  [
    'Security monitoring signals',
    'Security monitoring summary showing document scan records, audit-integrity signals, and related security posture indicators.',
  ],
  [
    'Document scan event records',
    'Document scan records showing latest scan status, rejection counts, and quarantine counts for reviewed files.',
  ],
  [
    'Retention job records',
    'Retention job records showing retention posture and job outcomes available for later operational review.',
  ],
  [
    'Vendor access audit event inventory',
    'Audit event inventory listing vendor-use and vendor-denial event types available for later review.',
  ],
  [
    'Membership lifecycle audit event inventory',
    'Audit event inventory listing member removal, suspension, deactivation, reactivation, and SCIM deprovisioning lifecycle events.',
  ],
  [
    'Organization permission decision logic',
    'Authorization decision logic describing membership state, viewer role, enterprise constraints, and permission-specific checks used before organization actions proceed.',
  ],
  [
    'Explicit secure session settings',
    'Secure session settings showing session expiry, refresh cadence, freshness window, database-backed session handling, and cookie-cache protections.',
  ],
  [
    'Auth and site URL validation',
    'Runtime validation showing canonical origin checks for security-sensitive auth and site URLs before use.',
  ],
  [
    'Vendor runtime validation',
    'Runtime validation showing privacy-mode and API-key checks required before outbound model use.',
  ],
  [
    'Fail-closed Better Auth env validation',
    'Fail-closed authentication environment validation rejecting invalid auth URL, preview-host, and trusted-origin configuration at startup.',
  ],
  [
    'Signed file-serving flow',
    'Signed file-serving workflow showing HMAC-backed signing and verification used for protected file access.',
  ],
  [
    'Managed malware-scan stack definition',
    'Managed malware-scan stack definition showing the protected files bucket, GuardDuty malware protection plan, event routing, and forwarding components used for document scanning.',
  ],
  [
    'Reproducible compliance refresh workflow',
    'Compliance refresh workflow showing regeneration of compliance artifacts from source instead of manual edits.',
  ],
  [
    'Compliance refresh command chain',
    'Compliance refresh command chain showing scripted regeneration of framework extracts and the active control register from source inputs.',
  ],
  [
    'Generated control register source of truth',
    'Control register generation workflow showing that the active control register seed is built from framework extracts and local blueprint definitions.',
  ],
]);

function normalizeBuyerFacingText(text: string) {
  return text
    .replaceAll('repo-backed workspace', 'workspace')
    .replaceAll('repo-backed control workspace', 'control workspace')
    .replaceAll('repo-backed product artifacts', 'workspace artifacts')
    .replaceAll('repo-backed register', 'register')
    .replaceAll('repo-backed platform evidence', 'platform evidence')
    .replaceAll('repo-backed membership lifecycle artifacts', 'membership lifecycle artifacts')
    .replaceAll('site-admin', 'site admin')
    .replaceAll('site admin security posture surfaces', 'site admin security posture summaries')
    .replaceAll('site-admin review surfaces', 'site admin review interfaces')
    .replaceAll('review surfaces', 'review interfaces')
    .replaceAll('evidence review surfaces', 'evidence review interfaces')
    .replaceAll('management surface', 'management interface')
    .replaceAll('provider-facing surfaces', 'provider review interfaces')
    .replaceAll('review-state artifacts', 'review records')
    .replaceAll('file-ingest surfaces', 'file-ingest workflows')
    .replaceAll('operator-run', 'provider-managed')
    .replaceAll('operator backup configuration', 'provider backup configuration')
    .replaceAll('operator change-management procedures', 'provider change-management procedures')
    .replaceAll('operator processes', 'provider processes');
}

function normalizeChecklistLabel(label: string) {
  return CHECKLIST_LABEL_REWRITES.get(label) ?? normalizeBuyerFacingText(label);
}

function normalizeChecklistDescription(description: string) {
  return (
    CHECKLIST_DESCRIPTION_REWRITES.get(description) ??
    normalizeBuyerFacingText(description)
      .replaceAll('supported surfaces', 'supported interfaces')
      .replaceAll(
        'support provider awareness or orientation material',
        'support provider awareness and orientation material',
      )
      .replaceAll(
        'surface the effective baseline posture',
        'present the effective baseline posture',
      )
  );
}

function normalizeEvidenceTitle(title: string) {
  return (
    EVIDENCE_TITLE_REWRITES.get(title) ??
    title
      .replaceAll('site-admin', 'site admin')
      .replace(/\bUI\b/g, 'interface')
      .replace(/\bsurface\b/gi, 'interface')
      .replace(/review storage/gi, 'review record structure')
      .replace(/review-state schema/gi, 'review record structure')
      .replace(/^Security admin\b/, 'Administrative security')
  );
}

function stripEvidenceSourcePrefix(description: string) {
  return description.replace(
    /^(?:[a-zA-Z0-9_./-]+\.(?:ts|tsx|cts|mjs|md|json))(?: and [a-zA-Z0-9_./-]+\.(?:ts|tsx|cts|mjs|md|json))*\s+/,
    '',
  );
}

function normalizeEvidencePredicate(predicate: string) {
  return predicate
    .replace(/^documents\b/i, 'describing')
    .replace(/^explains\b/i, 'describing')
    .replace(/^states\b/i, 'describing')
    .replace(/^defines\b/i, 'describing')
    .replace(/^includes\b/i, 'including')
    .replace(/^stores\b/i, 'retaining')
    .replace(/^records\b/i, 'recording')
    .replace(/^aggregates\b/i, 'summarizing')
    .replace(/^reports\b/i, 'summarizing')
    .replace(/^renders\b/i, 'showing')
    .replace(/^displays\b/i, 'showing')
    .replace(/^presents\b/i, 'showing')
    .replace(/^provides\b/i, 'providing')
    .replace(/^exposes\b/i, 'providing')
    .replace(/^implements\b/i, 'implementing')
    .replace(/^enforces\b/i, 'enforcing')
    .replace(/^rejects\b/i, 'rejecting')
    .replace(/^requires\b/i, 'requiring')
    .replace(/^validates\b/i, 'validating')
    .replace(/^uses\b/i, 'applying')
    .replace(/^applies\b/i, 'applying')
    .replace(/^manages\b/i, 'managing')
    .replace(/^manage\b/i, 'managing')
    .replace(/^supports\b/i, 'supporting')
    .replace(/^support\b/i, 'supporting')
    .replace(/^allows reviewers to\b/i, 'allowing reviewers to')
    .replace(/^allow reviewers to\b/i, 'allowing reviewers to')
    .replace(/^allows\b/i, 'allowing')
    .replace(/^allow\b/i, 'allowing')
    .replace(/^enumerates\b/i, 'listing')
    .replace(/^emits\b/i, 'recording')
    .replace(/^creates and verifies\b/i, 'creating and verifying')
    .replace(/^signs and verifies\b/i, 'signing and verifying')
    .replace(/^generates and exports\b/i, 'supporting generation and export of')
    .replace(/^generates and\b/i, 'supporting')
    .replace(/^generates\b/i, 'supporting generation of')
    .replace(/^exports\b/i, 'supporting export of')
    .replace(/^creates\b/i, 'creating')
    .replace(/^signs\b/i, 'signing')
    .replace(
      'mark evidence reports reviewed or needs follow-up',
      'mark evidence reports as reviewed or requiring follow-up',
    )
    .replace(
      'mark evidence reports reviewed or needing follow-up',
      'mark evidence reports as reviewed or requiring follow-up',
    )
    .replace('review state', 'review status')
    .replace(
      'showing a Restore Drill summary card showing',
      'showing the Restore Drill summary card with',
    )
    .replace(
      'showing the control workspace and evidence review interfaces for security administrators',
      'showing the control workspace and evidence review interface available to authorized security administrators',
    );
}

function evidenceArtifactNoun(title: string) {
  const normalizedTitle = normalizeEvidenceTitle(title).toLowerCase();

  if (normalizedTitle.includes('route')) return 'Route';
  if (normalizedTitle.includes('interface')) return 'Interface';
  if (normalizedTitle.includes('workspace')) return 'Workspace';
  if (normalizedTitle.includes('page')) return 'Page';
  if (normalizedTitle.includes('summary')) return 'Summary';
  if (normalizedTitle.includes('card')) return 'Card';
  if (
    normalizedTitle.includes('schema') ||
    normalizedTitle.includes('structure') ||
    normalizedTitle.includes('metadata') ||
    normalizedTitle.includes('model')
  ) {
    return 'Schema';
  }
  if (
    normalizedTitle.includes('workflow') ||
    normalizedTitle.includes('flow') ||
    normalizedTitle.includes('path') ||
    normalizedTitle.includes('pipeline') ||
    normalizedTitle.includes('action') ||
    normalizedTitle.includes('mutation')
  ) {
    return 'Workflow';
  }
  if (
    normalizedTitle.includes('guidance') ||
    normalizedTitle.includes('note') ||
    normalizedTitle.includes('matrix') ||
    normalizedTitle.includes('procedure') ||
    normalizedTitle.includes('documentation')
  ) {
    return 'Documentation';
  }
  if (normalizedTitle.includes('inventory')) return 'Inventory';
  if (normalizedTitle.includes('event')) return 'Event inventory';

  return normalizeEvidenceTitle(title);
}

function normalizeEvidenceDescription(title: string, description: string | null) {
  if (!description) {
    return description;
  }

  const normalizedTitle = normalizeEvidenceTitle(title);
  const rewrittenDescription = EVIDENCE_DESCRIPTION_REWRITES.get(normalizedTitle);
  if (rewrittenDescription) {
    return rewrittenDescription;
  }

  const predicate = normalizeEvidencePredicate(
    stripEvidenceSourcePrefix(normalizeBuyerFacingText(description)),
  ).replace(/\.$/, '');

  return `${evidenceArtifactNoun(normalizedTitle)} ${predicate}.`;
}

const ACTIVE_CONTROL_BLUEPRINTS: ReadonlyArray<{
  csf20Ids?: string[];
  hipaaCitations: string[];
  coverage: Coverage;
  implementationSummary: string;
  internalControlId: string;
  nist80053Id: string;
  nist80066: Array<{
    label: string | null;
    mappingType: 'key-activity' | 'relationship' | 'sample-question' | null;
    referenceId: string;
  }>;
  owner: string;
  priority: 'p0' | 'p1' | 'p2';
  platformChecklistItems: Array<{
    description: string;
    itemId: string;
    label: string;
    required: boolean;
    seed: {
      evidence: Array<{
        description: string | null;
        evidenceType: SeededChecklistEvidenceType;
        sufficiency: ChecklistEvidenceSufficiency;
        title: string;
        url: string | null;
      }>;
      notes: string;
      owner: string;
      status: ChecklistStatus;
    };
    suggestedEvidenceTypes: ChecklistEvidenceType[];
    verificationMethod: string;
  }>;
  responsibility: Responsibility;
  soc2CriterionIds?: string[];
  customerResponsibilityNotes: string;
}> = [
  {
    nist80053Id: 'AT-2',
    internalControlId: 'CTRL-AT-002',
    implementationSummary:
      'This control addresses provider security awareness and literacy training for use of the hosted service and its privileged security features. The repo-backed workspace currently provides training-supporting reference material through auth-security notes, control-matrix guidance, and site admin security posture surfaces, but it does not evidence a formal provider training program, completion records, or recurring update cadence.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Awareness and Training',
    hipaaCitations: ['45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'security-awareness-reference-material-documented',
        label: 'Provider security-awareness reference material is documented',
        description:
          'The provider should maintain reference material describing key security expectations for the hosted service and its privileged access paths.',
        verificationMethod: 'Security guidance document review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo includes documented security expectations and control-boundary notes that can support provider awareness walkthroughs.',
          [
            seededEvidence(
              'Auth security guidance',
              'docs/AUTH_SECURITY.md documents privileged-access expectations such as MFA or passkey use, trusted-origin requirements, and deployer-owned security gaps.',
            ),
            seededEvidence(
              'Control matrix guidance',
              'docs/CONTROL_MATRIX.md explains which security safeguards are enforced in the hosted service and which security responsibilities remain deployer-owned.',
            ),
          ],
          'Security Awareness and Training',
        ),
      },
      {
        itemId: 'site-admin-security-posture-supports-awareness-walkthroughs',
        label: 'Site admin security posture surfaces can support provider awareness walkthroughs',
        description:
          'The hosted service should surface current security posture information that providers can reference during awareness or operational security walkthroughs.',
        verificationMethod: 'Site admin security workspace walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace surfaces MFA posture, audit integrity, file inspection, retention, backup verification, and related security status that can support provider awareness or orientation material.',
          [
            seededEvidence(
              'Security posture aggregation',
              'convex/security.ts aggregates MFA coverage, audit integrity, file inspection, retention, backup verification, and vendor posture for the site admin security workspace.',
            ),
            seededEvidence(
              'Site admin security posture UI',
              'src/routes/app/admin/security.tsx renders posture summary cards and control evidence views that can support provider security walkthroughs.',
            ),
          ],
          'Security Awareness and Training',
        ),
      },
      {
        itemId: 'provider-security-awareness-program-documented',
        label: 'Provider security awareness training program and cadence are documented',
        description:
          'The provider should document who receives security awareness training, how often it is delivered, when it is updated, and how completion is recorded for personnel supporting the hosted service.',
        verificationMethod: 'Training program review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a provider-owned security awareness training program, attendance evidence, or recurring update cadence.',
          [],
          'Security Awareness and Training',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for training their own workforce, administrators, and contractors on secure use of the hosted service, their internal policies, and any connected systems or workflows they operate outside the hosted service boundary.',
  },
  {
    nist80053Id: 'AT-3',
    internalControlId: 'CTRL-AT-003',
    implementationSummary:
      'This control ensures privileged and support personnel can be trained on the specific security responsibilities tied to their hosted-service roles. The hosted service supports that objective through documented admin-only boundaries, privileged-authentication expectations, and site admin security posture views that can anchor role-based walkthroughs, but a formal provider role-based training program and completion records are not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Awareness and Training',
    hipaaCitations: ['45 CFR 164.308(a)(5)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'privileged-role-security-expectations-are-documented',
        label: 'Privileged-role security expectations are documented',
        description:
          'The provider should document the security expectations that apply to site admin and other privileged roles supporting the hosted service.',
        verificationMethod: 'Role and security guidance review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The workspace includes documented privileged-role boundaries and stronger-authentication expectations that can anchor role-based security training.',
          [
            seededEvidence(
              'Privileged authentication guidance',
              'Security notes describe MFA or passkey expectations for site admin and other privileged access paths in regulated deployments.',
            ),
            seededEvidence(
              'Admin-only capability map',
              'Architecture documentation identifies admin-only routes, capabilities, and route-guard patterns that define the privileged service boundary.',
            ),
          ],
          'Security Awareness and Training',
        ),
      },
      {
        itemId: 'site-admin-security-posture-supports-role-based-walkthroughs',
        label: 'Site admin security posture can support privileged-role security walkthroughs',
        description:
          'Authorized site admins should be able to review current security posture information that can be used during role-based operational security walkthroughs.',
        verificationMethod: 'Site admin security workspace walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin security workspace presents posture summaries and evidence views that can support role-based security reviews for privileged personnel.',
          [
            seededEvidence(
              'Site admin security posture interface',
              'The administrative security interface shows MFA posture, audit integrity, file inspection, retention, backup verification, and related control evidence for provider review.',
            ),
            seededEvidence(
              'Operational control matrix guidance',
              'The control matrix explains which safeguards ship with the hosted service and which operational gaps remain provider- or customer-managed.',
            ),
          ],
          'Security Awareness and Training',
        ),
      },
      {
        itemId: 'provider-role-based-security-training-program-documented',
        label: 'Provider role-based security training program is documented',
        description:
          'The provider should document how privileged and support personnel receive role-specific security training, how often that training is refreshed, and how completion is recorded.',
        verificationMethod: 'Training program review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The workspace does not yet include a documented provider role-based security training program, completion records, or refresher cadence for privileged and support personnel.',
          [],
          'Security Awareness and Training',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for role-based security training for their own administrators, support personnel, and contractors who configure or operate customer-managed workflows outside the hosted service boundary.',
  },
  {
    nist80053Id: 'AC-2',
    internalControlId: 'CTRL-AC-002',
    implementationSummary:
      'This control ensures accounts are approved, provisioned, changed, and removed through controlled lifecycle workflows. The platform supports that objective through invitation and policy controls, SCIM-backed provisioning paths, member-state lifecycle handling, and auditable membership events in the hosted service.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Identity and Access Management',
    hipaaCitations: ['45 CFR 164.308(a)(3)', '45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    csf20Ids: ['PR.AA-01', 'PR.AA-05'],
    soc2CriterionIds: ['CC6.1', 'CC6.2'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'account-approval-and-role-assignment',
        label: 'Account approval and role assignment controls exist',
        description:
          'Account creation and privileged role assignment should flow through authorized invitation, provisioning, or administrative paths.',
        verificationMethod: 'Invitation, provisioning, and role-assignment workflow review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Invitation policies, admin-managed member changes, and SCIM lifecycle paths provide controlled account creation and role assignment paths.',
          [
            seededEvidence(
              'Organization invitation and policy controls',
              'convex/organizationManagement.ts enforces invitePolicy, verifiedDomainsOnly, and memberCap controls before new organization access is granted.',
            ),
            seededEvidence(
              'Controlled member role updates',
              'convex/organizationManagement.ts resolves organization access context before member role changes and provisioning actions proceed.',
            ),
          ],
        ),
      },
      {
        itemId: 'account-lifecycle-controls',
        label: 'Account lifecycle controls are implemented',
        description:
          'Invitations, provisioning, suspension, deactivation, and reactivation workflows must support controlled onboarding and offboarding.',
        verificationMethod: 'Organization management and provisioning workflow review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Organization policies constrain invitations and seat growth, while SCIM and member-state workflows support lifecycle changes.',
          [
            seededEvidence(
              'Organization access policy controls',
              'convex/organizationManagement.ts enforces invitePolicy, verifiedDomainsOnly, and memberCap policy checks; src/features/organizations/components/OrganizationPoliciesCard.tsx exposes the management surface.',
            ),
            seededEvidence(
              'SCIM provisioning workflow',
              'src/features/organizations/components/OrganizationProvisioningManagement.tsx and src/features/organizations/server/organization-management.ts manage SCIM endpoint and bearer-token lifecycle for automated provisioning.',
            ),
          ],
        ),
      },
      {
        itemId: 'account-access-reviewed-periodically',
        label: 'Account access can be reviewed periodically',
        description:
          'The hosted service should provide reviewable membership and session context so providers or customers can periodically validate whether account access remains appropriate.',
        verificationMethod: 'Membership and session review workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['system', 'file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'Organization membership state and active session details are reviewable, but the workspace does not yet include a formal recurring access-review record or cadence.',
          [
            seededEvidence(
              'Organization membership management interface',
              'Organization member management views show current members, roles, and suspended or deactivated state for customer administrators reviewing access.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Administrative user session review interface',
              'Administrative session review dialogs show active sessions, creation time, expiry, IP address, and revocation actions for user access review.',
              { sufficiency: 'partial' },
            ),
          ],
        ),
      },
      {
        itemId: 'membership-audit',
        label: 'Membership changes are auditable',
        description: 'Administrative membership changes must emit reviewable audit records.',
        verificationMethod: 'Audit event review',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Membership lifecycle events are emitted as audit events and reviewable through organization audit history.',
          [
            seededEvidence(
              'Organization membership audit events',
              'src/lib/shared/auth-audit.ts defines member_added, member_removed, member_role_updated, member_suspended, member_deactivated, member_reactivated, and SCIM lifecycle event types.',
            ),
            seededEvidence(
              'Organization audit review surface',
              'src/features/organizations/components/OrganizationAuditPage.tsx exposes membership-related audit history to organization owners, admins, and site admins.',
            ),
          ],
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for workforce onboarding, termination, role assignment approval, and periodic access review.',
  },
  {
    nist80053Id: 'AC-3',
    internalControlId: 'CTRL-AC-003',
    implementationSummary:
      'This control ensures users and processes can perform only the actions and data access they are authorized to use. The platform addresses that objective primarily through server-side authorization checks, organization-scoped permission decisions, and protected route guards that prevent accidental exposure in the user interface.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Application Authorization',
    hipaaCitations: ['45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    csf20Ids: ['PR.AA-05'],
    soc2CriterionIds: ['CC6.1', 'CC6.3'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'route-guards',
        label: 'Protected routes are guarded',
        description:
          'Protected pages must require authorized access before rendering sensitive content.',
        verificationMethod: 'Route guard review and route-level test coverage',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Protected routes are guarded through shared auth and admin guard utilities.',
          [
            seededEvidence(
              'Shared route guards',
              'src/features/auth/server/route-guards.ts and auth-guards.ts provide requireAuth and requireAdmin guard paths used across protected flows.',
            ),
          ],
          'Application Authorization',
        ),
      },
      {
        itemId: 'server-authorization',
        label: 'Server authorization checks enforce access',
        description:
          'Server-side actions and data access must enforce role-appropriate authorization.',
        verificationMethod: 'Server function inspection and automated tests',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Server-side access checks rely on shared auth guards, site-admin wrappers, and organization permission decisions before sensitive actions proceed.',
          [
            seededEvidence(
              'Server auth guard enforcement',
              'src/features/auth/server/auth-guards.ts implements requireAuth and requireAdmin for protected server operations.',
            ),
            seededEvidence(
              'Authorization builders and access decisions',
              'convex/auth/authorized.ts and convex/auth/access.ts provide protected builders and role-aware access decisions for sensitive server paths.',
            ),
          ],
          'Application Authorization',
        ),
      },
      {
        itemId: 'organization-permissions',
        label: 'Organization-scoped permissions restrict actions',
        description:
          'Organization membership, role, and policy context must constrain who can manage organization resources.',
        verificationMethod: 'Organization access context and permission helper review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Organization access is evaluated against viewer role, membership state, and policy gates before privileged actions are allowed.',
          [
            seededEvidence(
              'Organization permission helpers',
              'src/features/organizations/lib/organization-permissions.ts defines organization capability rules used across directory and policy workflows.',
            ),
            seededEvidence(
              'Organization access enforcement',
              'convex/organizationManagement.ts resolves organization access context and rejects unauthorized member, policy, and provisioning mutations.',
            ),
          ],
          'Application Authorization',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for defining roles, approving privileged access, and maintaining least-privilege assignments within the service.',
  },
  {
    nist80053Id: 'AU-2',
    internalControlId: 'CTRL-AU-002',
    implementationSummary:
      'This control ensures security-relevant events are identified and recorded with enough context to support oversight. The platform addresses that objective by capturing audit events for authentication, administrative, organization, evidence, and file-handling activity and by exposing those records to authorized reviewers.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Audit and Logging',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'audit-event-capture',
        label: 'Security-relevant events are captured',
        description:
          'Authentication, administrative, and security-significant events must be recorded.',
        verificationMethod: 'Audit log inspection',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Audit event types cover authentication, organization, attachment, and evidence-report activity.',
          [
            seededEvidence(
              'Audit event inventory',
              'src/lib/shared/auth-audit.ts defines a broad set of security-relevant audit event types.',
            ),
          ],
          'Audit and Logging',
        ),
      },
      {
        itemId: 'audit-review-surface',
        label: 'Authorized reviewers can inspect audit records',
        description:
          'Authorized reviewers must be able to inspect captured audit activity through supported review surfaces.',
        verificationMethod: 'Audit review workflow walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform exposes audit history views to authorized reviewers in organization and security-admin surfaces.',
          [
            seededEvidence(
              'Organization audit review UI',
              'src/features/organizations/components/OrganizationAuditPage.tsx provides audit history review for authorized organization roles.',
            ),
            seededEvidence(
              'Security admin audit review surface',
              'src/routes/app/admin/security.tsx exposes recent security signals and linked evidence for authorized administrative review.',
            ),
          ],
          'Audit and Logging',
        ),
      },
      {
        itemId: 'audit-record-context',
        label: 'Audit records retain actor and event context',
        description:
          'Recorded audit entries should retain event, actor, and related resource context needed for review.',
        verificationMethod: 'Audit record structure review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Audit records carry event metadata and resource context that reviewers can inspect later.',
          [
            seededEvidence(
              'Structured audit record insertion',
              'convex/audit.ts records eventType, actor, resource metadata, and serialized event metadata when audit entries are inserted.',
            ),
          ],
          'Audit and Logging',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for reviewing exported audit records and aligning retention or downstream log handling with their own policies when those records leave the platform.',
  },
  {
    nist80053Id: 'AU-6',
    internalControlId: 'CTRL-AU-006',
    implementationSummary:
      'This control ensures the hosted service provides reviewable audit history and retains review-state artifacts that support provider-side audit analysis and follow-up. The platform supplies audit history views and evidence-report review workflows, but a formal provider review cadence and escalation procedure are not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Operations',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['DE.AE-02'],
    soc2CriterionIds: ['CC7.2'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'review-queue-surface',
        label: 'Provider-facing audit review surfaces exist',
        description:
          'The platform must provide supported surfaces for reviewing audit activity and related security evidence.',
        verificationMethod: 'Audit review UI walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Security administrators can review audit history and evidence state through built-in provider-facing surfaces.',
          [
            seededEvidence(
              'Security admin review surface',
              'src/routes/app/admin/security.tsx exposes control workspace and evidence review surfaces for security administrators.',
            ),
          ],
          'Security Operations',
        ),
      },
      {
        itemId: 'review-record-retention',
        label: 'Audit review state and follow-up records can be retained',
        description:
          'The platform should retain review status, reviewer identity, notes, and export integrity data when audit evidence is reviewed.',
        verificationMethod: 'Evidence report schema and review workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence reports persist review status, notes, reviewer identity, and integrity-linked export data for later inspection.',
          [
            seededEvidence(
              'Evidence report review storage',
              'convex/schema.ts defines reviewStatus, reviewedAt, reviewedByUserId, reviewNotes, contentHash, and exportIntegritySummary fields for evidenceReports.',
            ),
            seededEvidence(
              'Evidence report review workflow',
              'src/routes/app/admin/security.tsx and convex/security.ts allow reviewers to mark evidence reports reviewed or needs follow-up with notes.',
            ),
          ],
          'Security Operations',
        ),
      },
      {
        itemId: 'provider-review-procedure',
        label: 'Provider audit review procedure is documented',
        description:
          'The provider documents internal audit review cadence, escalation expectations, and follow-up steps for the hosted service.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider-owned documented review cadence or escalation procedure is attached in the repo-backed control workspace yet.',
          [],
          'Security Operations',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for their own review and follow-up processes for any audit exports or evidence they retain outside the hosted service.',
  },
  {
    nist80053Id: 'IA-2',
    internalControlId: 'CTRL-IA-002',
    implementationSummary:
      'This control ensures users are uniquely identified and authenticated before accessing protected service functionality. The platform supports that objective through authenticated access flows, verified-email enforcement, MFA or passkey enforcement for regulated access, and fresh-session step-up for sensitive operations.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Authentication',
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'authenticated-access',
        label: 'Authenticated access is required',
        description: 'The platform must require authenticated access for protected user areas.',
        verificationMethod: 'Authentication flow walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Protected application use depends on authenticated sessions and server-side identity checks before access is granted.',
          [
            seededEvidence(
              'Authenticated access guardrails',
              'src/features/auth/server/auth-guards.ts and route-guards.ts gate protected access while convex/auth/access.ts resolves authenticated user context for server-side authorization.',
            ),
            seededEvidence(
              'Auth runtime session handling',
              'convex/betterAuth/sharedOptions.ts configures the Better Auth server plugin set and session handling used for authenticated access.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'verified-email',
        label: 'Verified email checks are enforced',
        description:
          'Production authentication flows must enforce verified-email expectations where required.',
        verificationMethod: 'Policy inspection and auth configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Verified email is enforced before protected access and is part of the regulated baseline.',
          [
            seededEvidence(
              'Verified email enforcement',
              'src/features/auth/server/auth-guards.ts redirects unverified accounts away from protected access and src/lib/shared/security-baseline.ts requires verified email by default.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'mfa-enforcement',
        label: 'MFA or passkeys are enforced for regulated access',
        description:
          'The platform must enforce stronger authenticators for privileged or regulated organization access paths.',
        verificationMethod: 'Authentication policy and step-up workflow review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The regulated baseline requires MFA or passkeys, and privileged access paths enforce that requirement.',
          [
            seededEvidence(
              'Regulated MFA baseline',
              'src/lib/shared/security-baseline.ts requires MFA or passkeys for regulated organizations and src/features/organizations/components/OrganizationPoliciesCard.tsx presents the always-enforced posture.',
            ),
            seededEvidence(
              'MFA and fresh-session enforcement',
              'src/features/auth/server/auth-guards.ts and convex/organizationManagement.ts require MFA/passkey presence or a fresh session before privileged access and regulated join flows.',
            ),
          ],
          'Authentication',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for identity proofing, MFA policy decisions, user enrollment expectations, and account lifecycle governance.',
  },
  {
    nist80053Id: 'IA-5',
    internalControlId: 'CTRL-IA-005',
    implementationSummary:
      'This control ensures authenticators are managed, protected, and recoverable in a controlled manner. The platform supports that objective through stronger authenticators, recovery-related auditing, and guarded reset or account-recovery flows.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Authentication',
    hipaaCitations: ['45 CFR 164.308(a)(5)(ii)(D)', '45 CFR 164.312(d)'],
    csf20Ids: ['PR.AA-01', 'PR.AA-03'],
    soc2CriterionIds: ['CC6.1', 'CC6.2'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'strong-authenticators',
        label: 'Strong authenticators are available',
        description:
          'The platform must support strong authenticators such as passkeys or MFA factors.',
        verificationMethod: 'Authenticator capability review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform supports passkeys and built-in two-factor authentication for stronger authenticator management.',
          [
            seededEvidence(
              'Passkey and two-factor support',
              'convex/betterAuth/sharedOptions.ts enables passkey and two-factor plugins, and profile UI exposes authenticator management flows.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'recovery-audit',
        label: 'Recovery events are audited',
        description: 'Password reset and recovery events must be logged for review.',
        verificationMethod: 'Audit log inspection',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Password reset request and completion events are defined for later review.',
          [
            seededEvidence(
              'Password reset audit events',
              'src/lib/shared/auth-audit.ts includes password_reset_requested and password_reset_completed event types.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'recovery-guardrails',
        label: 'Recovery and authenticator changes are guarded',
        description:
          'Authenticator recovery and sign-in credential changes must be constrained by rate limits or fresh-session checks.',
        verificationMethod: 'Recovery flow configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Sensitive auth endpoints are rate-limited and sign-in email changes require a fresh session.',
          [
            seededEvidence(
              'Better Auth recovery rate limits',
              'convex/betterAuth/sharedOptions.ts applies per-route rate limits for password reset, verification email, and credential-management endpoints.',
            ),
            seededEvidence(
              'Fresh-session change-email protection',
              'convex/betterAuth/sharedOptions.ts blocks change-email unless the session satisfies the recent step-up freshness window.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'compromised-authenticators-can-be-revoked',
        label: 'Compromised sessions and authenticators can be revoked',
        description:
          'The hosted service should provide revocation paths for active sessions or other authenticator context when compromise is suspected.',
        verificationMethod: 'Session revocation workflow review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform provides current-user and site-admin session revocation paths that support containment after suspected credential compromise.',
          [
            seededEvidence(
              'Administrative session revocation workflow',
              'Administrative user-session review includes revoke-one and revoke-all actions for active sessions associated with a managed user.',
            ),
            seededEvidence(
              'Sensitive session revocation endpoints',
              'Auth configuration includes explicit revoke-session and revoke-all-sessions routes with server-side rate limiting for security-sensitive session invalidation.',
            ),
          ],
          'Authentication',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for defining allowed credential types, approving recovery workflows, and governing exceptions to standard authentication policy.',
  },
  {
    nist80053Id: 'CP-2',
    internalControlId: 'CTRL-CP-002',
    implementationSummary:
      'This control ensures contingency-planning artifacts exist for the hosted service and can be updated using current recovery evidence. The hosted service supports that objective through documented architecture context, backup-verification records, and audit-readiness exports that can inform contingency planning, but a formal provider contingency plan, approval record, and recurring revision process are not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Infrastructure Operations',
    hipaaCitations: ['45 CFR 164.308(a)(7)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'contingency-planning-context-is-documented',
        label: 'Service architecture and recovery context are documented for contingency planning',
        description:
          'The provider should maintain architecture and operational context that can anchor contingency planning for the hosted service.',
        verificationMethod: 'Architecture and planning artifact review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The workspace includes architecture and control-boundary documentation that can support provider contingency planning for the hosted service.',
          [
            seededEvidence(
              'Architecture planning document',
              'Architecture documentation describes the application structure, privileged boundaries, and major service dependencies that contingency planning would need to account for.',
            ),
            seededEvidence(
              'Operational control boundary guidance',
              'The control matrix identifies which safeguards and recovery-related operational gaps are part of the hosted service versus external provider or customer responsibilities.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'recovery-evidence-can-inform-contingency-planning',
        label: 'Recovery evidence can inform contingency-planning updates',
        description:
          'The hosted service should retain recovery verification records that providers can use to review and update contingency-planning assumptions.',
        verificationMethod: 'Backup verification record review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Backup verification records and restore-drill audit events are retained and can inform provider contingency-planning updates.',
          [
            seededEvidence(
              'Backup verification record structure',
              'Stored backup verification records capture drill type, verification method, target environment, restored item count, artifact hash, summary, and review timestamp.',
            ),
            seededEvidence(
              'Restore drill audit trail',
              'Security operations record restore-drill success and failure events when verification results are stored for later review.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'contingency-planning-artifacts-can-be-packaged-for-review',
        label: 'Contingency-planning support artifacts can be packaged for provider review',
        description:
          'The hosted service should package recent recovery and readiness artifacts so providers can review them when maintaining contingency-planning materials.',
        verificationMethod: 'Audit readiness export review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace packages recent recovery and readiness artifacts into generated reports that can support provider planning review.',
          [
            seededEvidence(
              'Audit readiness report workflow',
              'The administrative security workspace generates readiness reports that include backup verification and other recent operational evidence for provider review.',
            ),
            seededEvidence(
              'Site admin readiness interface',
              'The site admin security interface presents restore-drill and related operational evidence alongside the report-generation workflow.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'provider-contingency-plan-documented',
        label: 'Provider contingency plan and revision workflow are documented',
        description:
          'The provider should document hosted-service contingency procedures, plan approval, revision triggers, and how recovery evidence updates the plan over time.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The workspace includes provider disaster recovery documentation and runbook material for hosted-service contingency procedures, but it does not yet evidence formal approval records or a recurring revision workflow tied to recovery evidence.',
          [
            seededEvidence(
              'Disaster recovery overview',
              'Procedure describing the hosted-service recovery paths, backup strategy, vendor-exit failover design, and recovery limitations that provider contingency planning should address.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Disaster recovery runbook',
              'Runbook describing prerequisites, backup infrastructure, recovery steps, post-recovery checks, and known limitations for provider disaster recovery operations.',
              { sufficiency: 'partial' },
            ),
          ],
          'Infrastructure Operations',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for their own business continuity and contingency plans for endpoints, downstream systems, local identity providers, and any operations they manage outside the hosted service boundary.',
  },
  {
    nist80053Id: 'CP-4',
    internalControlId: 'CTRL-CP-004',
    implementationSummary:
      'This control ensures the hosted service can record, surface, and retain contingency-test artifacts for provider review. The platform supports that objective through backup verification records, restore-drill audit events, and site-admin review surfaces for recent contingency evidence, but a formal provider contingency test plan, recurring cadence, and revision workflow are not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Infrastructure Operations',
    hipaaCitations: ['45 CFR 164.308(a)(7)(ii)(D)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['RC.RP-03'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'contingency-test-records-can-be-captured',
        label: 'Contingency test records can be captured for restore drills',
        description:
          'The hosted service should retain structured records for restore drills or other provider-recorded contingency verification activities.',
        verificationMethod: 'Backup verification record workflow review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform has a dedicated backup verification record path for restore verification and provider-recorded contingency drill evidence.',
          [
            seededEvidence(
              'Backup verification report schema',
              'convex/schema.ts defines backup verification reports with drill type, verification method, target environment, restored item count, artifact hash, summary, and checkedAt fields.',
            ),
            seededEvidence(
              'Backup verification write path',
              'convex/security.ts provides backup verification write handlers for persisting restore verification and operator-recorded drill evidence.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'restore-drill-results-are-auditable-and-reviewable',
        label: 'Restore drill results are auditable and reviewable in the site admin workspace',
        description:
          'Provider restore-drill outcomes should be surfaced in provider review flows and linked to auditable events.',
        verificationMethod: 'Site admin review surface walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Restore drill outcomes are reflected in audit events and surfaced in the site admin security workspace for provider review.',
          [
            seededEvidence(
              'Restore drill audit events',
              'convex/security.ts records backup restore drill completed and failed audit events when verification results are stored.',
            ),
            seededEvidence(
              'Site admin restore drill summary',
              'src/routes/app/admin/security.tsx renders a Restore Drill summary card showing the latest restore or operator-recorded backup verification evidence.',
            ),
            seededEvidence(
              'Operational evidence note',
              'docs/CONTROL_MATRIX.md states that backup verification records provide timestamped evidence that operators can link with deployment runbooks.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'contingency-test-artifacts-can-be-included-in-readiness-exports',
        label: 'Contingency test artifacts can be included in site admin readiness exports',
        description:
          'The hosted service should package recent contingency-test evidence into provider review or readiness exports when those artifacts are available.',
        verificationMethod: 'Audit readiness export review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace includes recent backup verification evidence in audit readiness review flows and generated exports.',
          [
            seededEvidence(
              'Audit readiness report generation',
              'src/routes/app/admin/security.tsx exposes Generate audit readiness report for current manifest, denial, metadata-gap, and restore-drill evidence.',
            ),
            seededEvidence(
              'Operational evidence summary',
              'docs/CONTROL_MATRIX.md states that the site admin security workspace exposes backup verification as part of internal operational evidence.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'provider-contingency-test-plan-documented',
        label: 'Provider contingency test plan and cadence are documented',
        description:
          'The provider should document contingency-test scope, success criteria, recurring cadence, and how test results drive revisions to hosted-service recovery procedures.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The repo-backed workspace includes a recurring backup-and-restore test workflow and runbook success criteria for hosted-service recovery exercises, but it does not yet include a formal revision workflow tied to test outcomes.',
          [
            seededEvidence(
              'Weekly DR backup workflow',
              'Scheduled workflow defining the provider backup, upload, deploy-test, and restore-test sequence for recurring hosted-service recovery verification.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Disaster recovery runbook test criteria',
              'Runbook guidance stating that the backup workflow is only successful when export, upload, deploy-test, and restore-test all pass.',
              { sufficiency: 'partial' },
            ),
          ],
          'Infrastructure Operations',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for testing their own business continuity, downstream restore procedures, and connected-system recovery workflows outside the hosted service boundary, and for deciding whether the provider contingency-test evidence satisfies their internal requirements.',
  },
  {
    nist80053Id: 'CP-9',
    internalControlId: 'CTRL-CP-009',
    implementationSummary:
      'This control ensures service data and required system information are backed up, protected, and recoverable after disruption or loss. The hosted service supports that objective through provider-operated backup workflow configuration, retained backup-verification records, retained restore-test results, and retained weekly workflow run metadata showing the production export path is configured and active.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure Operations',
    hipaaCitations: ['45 CFR 164.308(a)(7)(ii)(A)', '45 CFR 164.308(a)(7)(ii)(B)'],
    csf20Ids: ['PR.DS-11', 'RC.RP-03'],
    soc2CriterionIds: ['A1.2', 'A1.3'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'hosted-backups-configured',
        label: 'Hosted service backups are configured',
        description:
          'Provider-operated backups for production service data and essential system information should be defined and enabled.',
        verificationMethod: 'Infrastructure backup configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file', 'link'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform retains weekly backup workflow records showing the production export path, backup artifact upload, and related run metadata for the hosted environment.',
          [
            seededEvidence(
              'Weekly DR backup workflow',
              'Scheduled workflow that exports production Convex data, uploads the archive to the DR S3 bucket, verifies the uploaded artifact, and records the run results for provider review.',
            ),
            seededEvidence(
              'Disaster recovery configuration guide',
              'Configuration guide listing the GitHub Actions secrets and deployment inputs required for the provider backup workflow.',
            ),
            seededEvidence(
              'Retained backup workflow run record',
              'Stored backup verification records retain GitHub Actions run metadata, backup artifact location, step outcomes, and related evidence showing the hosted production export path is active.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'backup-verification-records-maintained',
        label: 'Backup verification records are maintained',
        description:
          'The platform should retain verification outcomes or supporting records for completed backup checks and recovery validation.',
        verificationMethod: 'Backup verification workflow review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform retains hosted-environment backup verification entries generated by the weekly DR workflow and presents those records for provider review.',
          [
            seededEvidence(
              'Retained backup verification record structure',
              'Schema and stored metadata for retained backup verification records, including drill type, verification method, target environment, restored item count, artifact content, and verification timestamp.',
            ),
            seededEvidence(
              'Weekly backup verification workflow',
              'Scheduled workflow that records backup verification results in the control workspace after export, upload, and verification steps complete.',
            ),
            seededEvidence(
              'Administrative backup drill review interface',
              'Administrative security route showing the latest backup drill status and related verification details available for provider review.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
      {
        itemId: 'restore-testing-recorded',
        label: 'Restore testing is performed and recorded',
        description:
          'Provider-operated restore tests and recovery validation results should be documented for the hosted service.',
        verificationMethod: 'Restore test record review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform retains restore-test outcomes from the weekly DR workflow and records matching audit events for provider review.',
          [
            seededEvidence(
              'Retained restore-test records',
              'Retained records showing restore verification outcomes, summary details, target environment, and supporting artifact content from backup recovery exercises.',
            ),
            seededEvidence(
              'Restore drill audit events',
              'Audit event inventory listing restore-drill completion and failure events recorded when recovery verification results are stored.',
            ),
            seededEvidence(
              'Weekly restore verification workflow',
              'Scheduled workflow that performs a restore test against a self-hosted Convex environment and records the outcome for provider review.',
            ),
          ],
          'Infrastructure Operations',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for determining whether the hosted service backup and recovery posture satisfies their retention, recovery-time, and business continuity requirements, and for protecting any data they export or replicate outside the service.',
  },
  {
    nist80053Id: 'IR-2',
    internalControlId: 'CTRL-IR-002',
    implementationSummary:
      'This control ensures incident responders can be trained using current hosted-service investigation artifacts and response-supporting context. The hosted service supports that objective through generated evidence reports, audit-readiness exports, and retained integrity-linked investigation records, but a formal provider incident response training program and completion records are not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Incident Response',
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'incident-training-support-artifacts-can-be-generated',
        label: 'Incident response support artifacts can be generated for responder training',
        description:
          'The hosted service should generate evidence and readiness artifacts that providers can use during incident response orientation or refresher training.',
        verificationMethod: 'Evidence and readiness generation walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace can generate evidence reports and audit-readiness outputs that package investigation-supporting material for responder training and review.',
          [
            seededEvidence(
              'Evidence report generation workflow',
              'The administrative security workflow generates structured evidence reports containing posture, audit, and integrity-linked review information.',
            ),
            seededEvidence(
              'Audit readiness export workflow',
              'The site admin security workflow can generate readiness reports that package recent security and recovery evidence for provider review.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'incident-investigation-context-is-retained-for-training-review',
        label: 'Incident investigation context is retained for training and follow-up review',
        description:
          'Investigation-supporting artifacts should retain integrity and review context so providers can reference realistic material during responder training or follow-up.',
        verificationMethod: 'Evidence artifact retention review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Generated evidence and audit-readiness artifacts retain integrity-linked metadata and review context that can support responder training review.',
          [
            seededEvidence(
              'Evidence report review record structure',
              'Stored evidence reports retain content hashes, review status, reviewer attribution, notes, and export-integrity metadata for later provider review.',
            ),
            seededEvidence(
              'Evidence report review interface',
              'The administrative security interface allows authorized reviewers to inspect report status, review notes, and export metadata associated with incident-supporting artifacts.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'provider-incident-response-training-program-documented',
        label: 'Provider incident response training program is documented',
        description:
          'The provider should document who receives incident response training, how training is refreshed, and how completion is recorded for personnel supporting the hosted service.',
        verificationMethod: 'Training program review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The workspace does not yet include a provider incident response training program, completion records, or documented refresher cadence.',
          [],
          'Security Incident Response',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for incident response training for their own responders, escalation teams, and administrators who operate customer-managed systems or local procedures outside the hosted service boundary.',
  },
  {
    nist80053Id: 'IR-3',
    internalControlId: 'CTRL-IR-003',
    implementationSummary:
      'This control ensures incident response procedures can be exercised using current hosted-service evidence and investigation workflows. The hosted service supports that objective through audit-readiness reports, investigation-supporting exports, and retained recovery evidence that can inform tabletop or walkthrough exercises, but a formal provider incident response exercise cadence, scenario library, and recorded results are not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Incident Response',
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'incident-exercise-support-artifacts-can-be-generated',
        label: 'Incident exercise support artifacts can be generated from the site admin workspace',
        description:
          'The hosted service should generate evidence packages that providers can use during tabletop exercises or incident-response walkthroughs.',
        verificationMethod: 'Evidence and readiness generation walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace can generate evidence and readiness artifacts that package current investigation-supporting material for incident exercises.',
          [
            seededEvidence(
              'Site admin evidence and readiness actions',
              'The administrative security interface exposes evidence-report and audit-readiness generation actions for current posture and review state.',
            ),
            seededEvidence(
              'Generated investigation-supporting exports',
              'Security workflows generate structured exports containing posture, audit, review, and integrity metadata that can be reused during exercises.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'recovery-and-investigation-evidence-can-support-incident-exercises',
        label: 'Recovery and investigation evidence can support incident-response exercises',
        description:
          'Providers should be able to review recovery and investigation artifacts together when validating incident-response assumptions or exercise scenarios.',
        verificationMethod: 'Readiness and restore evidence review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Restore-drill evidence and investigation-supporting reports are both retained in the site admin workspace and can support exercise review.',
          [
            seededEvidence(
              'Restore drill evidence records',
              'Stored backup verification and restore-drill records retain recent recovery outcomes that can inform incident-response exercises.',
            ),
            seededEvidence(
              'Audit readiness evidence review',
              'The site admin security workflow packages recent metadata gaps, denial events, and restore-drill evidence into readiness reports for provider review.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'incident-exercise-results-can-be-retained',
        label: 'Incident exercise artifacts and results can be retained for later review',
        description:
          'The hosted service should retain exercise-supporting records, review notes, or related recovery artifacts that providers can reference after an incident-response exercise.',
        verificationMethod: 'Exercise artifact retention review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The workspace retains recovery verification records and reviewable evidence-report context, but it does not yet contain a full set of incident exercise results or after-action records.',
          [
            seededEvidence(
              'Restore drill record structure',
              'Retained backup verification records capture recent recovery drill outcomes, timestamps, summaries, and artifact hashes for later provider review.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Evidence report review and follow-up workflow',
              'Evidence report review records retain reviewer notes, review status, and integrity metadata that could be referenced when capturing exercise follow-up.',
              { sufficiency: 'partial' },
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'provider-incident-response-exercise-program-documented',
        label: 'Provider incident response exercise cadence and results are documented',
        description:
          'The provider should document exercise scenarios, recurring cadence, participant roles, and recorded results for hosted-service incident-response testing.',
        verificationMethod: 'Exercise program review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The workspace does not yet include a provider incident response exercise schedule, scenario set, or recorded exercise results.',
          [],
          'Security Incident Response',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for testing their own incident response procedures, communication paths, and local recovery actions for systems and workflows they manage outside the hosted service boundary.',
  },
  {
    nist80053Id: 'IR-4',
    internalControlId: 'CTRL-IR-004',
    implementationSummary:
      'This control addresses incident handling for the hosted service and connected customer environment. The platform currently provides investigation-supporting audit trails, evidence exports, and retained review artifacts that can assist incident analysis, but provider incident response procedures and customer-side response workflows must be documented and operated outside these repo-backed product artifacts.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Security Incident Response',
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['RS.AN-03'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'incident-evidence-export',
        label: 'Provider investigation-supporting evidence can be exported',
        description:
          'The hosted service should expose audit trails and evidence exports that can support provider or customer investigations.',
        verificationMethod: 'Evidence export walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Audit and evidence export flows can support incident investigations and post-incident analysis.',
          [
            seededEvidence(
              'Evidence export support',
              'src/routes/app/admin/security.tsx and convex/security.ts support evidence report generation and export.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'investigation-artifacts-retained',
        label: 'Provider investigation artifacts can be retained with integrity metadata',
        description:
          'The hosted service should retain hashes, review state, and exported evidence metadata that support later investigation and post-incident analysis.',
        verificationMethod: 'Evidence report retention review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence reports persist review metadata and integrity-linked export details that can be used during investigations.',
          [
            seededEvidence(
              'Integrity-linked evidence reports',
              'convex/security.ts stores contentHash, exportHash, exportIntegritySummary, and review metadata for generated evidence reports.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'incident-handling-decisions-can-be-retained',
        label: 'Incident handling decisions and follow-up notes can be retained for review',
        description:
          'Investigation-supporting records should retain reviewer notes and follow-up status so providers can document handling decisions during or after an incident.',
        verificationMethod: 'Evidence report review workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence report review records retain review status, reviewer attribution, and notes that can support documented handling and follow-up decisions.',
          [
            seededEvidence(
              'Evidence report review record structure',
              'Stored evidence reports retain review status, reviewer identity, review timestamps, and reviewer notes alongside integrity metadata.',
            ),
            seededEvidence(
              'Evidence report review and follow-up workflow',
              'Administrative security review actions record reviewed or needs-follow-up status with trimmed reviewer notes for later investigation review.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'provider-incident-response-procedure',
        label: 'Provider incident response procedure is documented',
        description:
          'The provider should maintain documented incident response procedures covering triage, escalation, containment, customer coordination, and post-incident follow-up.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider-owned incident response procedure is attached in the repo-backed control workspace yet.',
          [],
          'Security Incident Response',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for incident detection, triage, escalation, containment, notification, and post-incident handling in their own environment; the platform evidence here provides investigation support only.',
  },
  {
    nist80053Id: 'IR-8',
    internalControlId: 'CTRL-IR-008',
    implementationSummary:
      'This control addresses incident response planning for the hosted service and connected customer environment. The platform currently provides investigation-supporting exports, retained integrity-linked evidence, and audit-readiness artifacts that can support provider or customer incident response planning, but a formal provider incident response plan, plan review cadence, and customer coordination procedure are not yet evidenced in this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Incident Response',
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'incident-planning-artifacts-can-be-generated',
        label: 'Incident-planning support artifacts can be generated from the site admin workspace',
        description:
          'The hosted service should generate exports and evidence packages that provider or customer responders can use during incident planning and coordination.',
        verificationMethod: 'Evidence and audit-readiness generation walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace can generate evidence reports and audit-readiness outputs that package investigation-supporting material for later response use.',
          [
            seededEvidence(
              'Evidence report generation and export',
              'convex/security.ts generates and exports evidence reports with structured posture, audit, and integrity data for review.',
            ),
            seededEvidence(
              'Site admin evidence and readiness actions',
              'src/routes/app/admin/security.tsx exposes Generate evidence report and Generate audit readiness report actions in the site admin workspace.',
            ),
            seededEvidence(
              'Operational evidence note',
              'docs/CONTROL_MATRIX.md states that audit log exports and related evidence are available, while incident response reporting remains a deployer task.',
              { sufficiency: 'partial' },
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'incident-supporting-context-can-be-retained',
        label: 'Incident-supporting evidence retains integrity and review context',
        description:
          'The hosted service should retain hashes, review state, and export metadata for investigation artifacts that may be referenced during incident response planning or execution.',
        verificationMethod: 'Evidence artifact retention review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Generated evidence and audit-readiness artifacts retain integrity-linked metadata and review context that can support later incident response use.',
          [
            seededEvidence(
              'Integrity-linked evidence report metadata',
              'convex/security.ts stores contentHash, exportHash, exportIntegritySummary, and review metadata for generated evidence reports.',
            ),
            seededEvidence(
              'Evidence report review-state schema',
              'convex/schema.ts defines reviewStatus, reviewedAt, reviewedByUserId, reviewNotes, contentHash, and exportHash fields used to preserve incident-supporting context.',
            ),
          ],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'provider-incident-response-plan-documented',
        label: 'Provider incident response plan is documented',
        description:
          'The provider should maintain a documented incident response plan covering roles, escalation paths, coordination expectations, and use of hosted-service investigation artifacts.',
        verificationMethod: 'Plan review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a provider-owned incident response plan document.',
          [],
          'Security Incident Response',
        ),
      },
      {
        itemId: 'provider-incident-response-plan-review-cadence-documented',
        label: 'Provider incident response plan review and update cadence is documented',
        description:
          'The provider should document how the incident response plan is reviewed, updated, and communicated when incident lessons or system changes require revision.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a formal provider review cadence or revision workflow for the incident response plan.',
          [],
          'Security Incident Response',
        ),
      },
    ],
    customerResponsibilityNotes:
      "Customer organizations are responsible for maintaining their own incident response plans, internal escalation paths, notification obligations, and coordination procedures for customer-managed systems and workflows outside the hosted service boundary. The hosted-service artifacts tracked here are intended to support planning and coordination, not replace either party's incident response plan.",
  },
  {
    nist80053Id: 'RA-5',
    internalControlId: 'CTRL-RA-005',
    implementationSummary:
      'This control addresses vulnerability and security finding identification. The platform supports that objective through automated file-inspection and malware-finding hooks, release-time dependency and code scanning, SBOM generation, and production deployment verification, but hosted-service remediation tracking and formal risk treatment still require provider processes outside this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Security Engineering',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)', '45 CFR 164.308(a)(1)(ii)(B)'],
    csf20Ids: ['ID.RA-01'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'scanner-program',
        label: 'Automated security scanning hooks exist',
        description:
          'The platform should implement automated scanning or inspection paths for security-relevant application, dependency, deployment, or ingest surfaces.',
        verificationMethod: 'Scanner implementation review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The platform has built-in file inspection plus release-time dependency, static-analysis, SBOM, and deployment-verification checks, but that is not a full hosted-service vulnerability-management program.',
          [
            seededEvidence(
              'Built-in file inspection',
              'src/lib/server/file-inspection.server.ts inspects file signatures, types, and size limits before files proceed through document workflows.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'GuardDuty malware finding pipeline',
              'infra/aws-cdk/lib/malware-scan-stack.cts provisions S3 malware scanning and convex/storageWebhook.ts verifies signed findings before quarantining affected files.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Release security validation workflow',
              'runs production dependency audit, Semgrep, OSV scanning, security boundary checks, and SBOM generation before deployment proceeds.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Release verification workflow',
              'Release workflow waits for the target deployment, runs post-deploy smoke checks, and runs an OWASP ZAP baseline against the production environment.',
              { sufficiency: 'partial' },
            ),
          ],
          'Security Engineering',
        ),
      },
      {
        itemId: 'remediation-tracking',
        label: 'Remediation and risk treatment are tracked',
        description: 'The platform must retain remediation tracking or risk acceptance artifacts.',
        verificationMethod: 'Issue or risk tracking review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No remediation-tracking or risk-acceptance artifact is attached from the codebase.',
          [],
          'Security Engineering',
        ),
      },
      {
        itemId: 'security-findings-can-be-reviewed-and-prioritized',
        label: 'Security findings can be reviewed with severity and disposition context',
        description:
          'The hosted service should retain reviewable finding details so providers can distinguish severity, status, and disposition before remediation decisions are made.',
        verificationMethod: 'Finding review and telemetry inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'Security findings and scan outcomes retain severity and status context in audit, monitoring, and release evidence records, but a full provider vulnerability triage workflow is not yet evidenced in this workspace.',
          [
            seededEvidence(
              'Organization audit severity records',
              'Organization audit records show event severity and event details for file-scan failures, quarantines, and related security findings under review.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Security monitoring summary',
              'Administrative security posture summaries show scan status, rejection counts, quarantine counts, and related finding totals for provider review.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Release provenance record workflow',
              'Release workflow records deployment outcome and production DAST result as retained release evidence that providers can review alongside other security findings.',
              { sufficiency: 'partial' },
            ),
          ],
          'Security Engineering',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for addressing vulnerabilities in their own endpoints, identity stores, integrations, and operational environments connected to the service.',
  },
  {
    nist80053Id: 'SC-8',
    internalControlId: 'CTRL-SC-008',
    implementationSummary:
      'This control ensures information transmitted by the service is protected against unauthorized disclosure or modification in transit. The platform addresses that objective through HTTPS-oriented auth configuration, trusted-origin checks, and secure session transport settings, while certificate lifecycle and edge enforcement evidence remain outside this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure and Platform Security',
    hipaaCitations: ['45 CFR 164.312(e)(1)', '45 CFR 164.312(e)(2)(i)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'tls-enabled',
        label: 'HTTPS-oriented endpoint configuration is enforced',
        description:
          'Production auth configuration and trusted origins must require secure transport for hosted endpoints.',
        verificationMethod: 'Auth URL and origin configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Better Auth configuration fails closed unless production origins use HTTPS and trusted origins are explicitly allowed.',
          [
            seededEvidence(
              'HTTPS Better Auth configuration',
              'src/lib/server/env.server.ts requires BETTER_AUTH_URL and trusted origins to use HTTPS unless they point to loopback development.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'session-transport',
        label: 'Secure session transport settings are enforced',
        description:
          'Session and temporary-link transport settings must align with secure transport expectations.',
        verificationMethod: 'Session configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Session cookies are configured for secure transport on HTTPS origins and short-lived auth settings support controlled session handling.',
          [
            seededEvidence(
              'Session transport configuration',
              'convex/betterAuth/sharedOptions.ts enables secure cookies for HTTPS origins and convex/security.ts reports sessionExpiryHours, freshWindowMinutes, and temporaryLinkTtlMinutes.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'certificate-operations',
        label: 'Certificate and edge operations are documented',
        description:
          'The hosted platform must retain evidence for certificate lifecycle management and edge enforcement.',
        verificationMethod: 'Infrastructure evidence review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'Certificate lifecycle management and edge enforcement artifacts are not stored in the repo-backed control workspace yet.',
          [],
          'Infrastructure and Platform Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for requiring secure access to the service within their own networks, browsers, devices, and downstream integrations.',
  },
  {
    nist80053Id: 'SC-12',
    internalControlId: 'CTRL-SC-012',
    implementationSummary:
      'This control addresses cryptographic key and secret management for signing and verification paths used by the hosted service. The platform enforces required runtime secrets for authentication and signed file or webhook flows, and it uses those configured secrets for HMAC-based protection, but secret generation, secure custody, rotation, and KMS or HSM controls remain deployment-owned and are not fully evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Infrastructure and Platform Security',
    hipaaCitations: ['45 CFR 164.312(a)(2)(iv)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'cryptographic-runtime-secrets-required',
        label: 'Cryptographic runtime secrets are required for protected service paths',
        description:
          'The hosted service should require configured secrets for authentication and signing-sensitive runtime paths before those paths can operate.',
        verificationMethod: 'Runtime configuration review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo fails closed when required auth and signing secrets are missing from protected runtime paths.',
          [
            seededEvidence(
              'Better Auth secret validation',
              'src/lib/server/env.server.ts requires BETTER_AUTH_SECRET outside tests and enforces minimum secret expectations before auth can start.',
            ),
            seededEvidence(
              'Storage signing secret validation',
              'src/lib/server/env.server.ts reads signing secrets while convex/fileServing.ts and convex/storageWebhook.ts throw when required signing secrets are not configured.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'configured-secrets-protect-signing-flows',
        label: 'Configured secrets protect signed service flows',
        description:
          'The hosted service should use configured secrets in cryptographic signing and verification paths that protect controlled access flows.',
        verificationMethod: 'Signing and verification path review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Configured secrets are used in HMAC-based file-serving and webhook-verification flows.',
          [
            seededEvidence(
              'Signed file-serving flow',
              'convex/fileServing.ts imports an HMAC key from the configured file-serving secret and signs or verifies protected file serve URLs.',
            ),
            seededEvidence(
              'Webhook signature verification',
              'convex/storageWebhook.ts signs and verifies GuardDuty webhook payloads with the configured shared secret, and infra/aws-cdk/lambda/guardduty-forwarder.mjs generates the forwarding signature.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'deployment-key-custody-and-rotation-documented',
        label: 'Deployment key custody and rotation are documented',
        description:
          'The provider or deployment operator should document how cryptographic secrets are generated, stored, rotated, and retired for the hosted environment.',
        verificationMethod: 'Key management procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo does not currently attach a documented secret-custody or rotation procedure for production cryptographic material.',
          [],
          'Infrastructure and Platform Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations and deployment operators are responsible for generating, storing, rotating, and retiring production cryptographic secrets in their own infrastructure, including any KMS, HSM, IAM, backup, and incident-response procedures tied to those secrets.',
  },
  {
    nist80053Id: 'SC-13',
    internalControlId: 'CTRL-SC-013',
    implementationSummary:
      'This control ensures the hosted service applies cryptographic protections to sensitive transport, storage, session, and integrity-sensitive workflows where the repo-backed platform evidence shows those protections. The platform currently evidences HTTPS-oriented auth configuration, secure session cookies, encrypted OAuth token handling, managed encrypted file storage, and cryptographic signing or hashing for protected file access and exported evidence. Selection of approved cryptographic standards, module validation, and broader deployment key governance remain outside this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Infrastructure and Platform Security',
    hipaaCitations: ['45 CFR 164.312(a)(2)(iv)', '45 CFR 164.312(e)(2)(i)', '45 CFR 164.312(c)(1)'],
    csf20Ids: ['PR.DS-01', 'PR.DS-02'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'cryptographic-transport-and-session-protections',
        label: 'Cryptographic protections are applied to hosted authentication and session flows',
        description:
          'Hosted authentication and session flows should require secure transport and use cryptographic protections appropriate to session handling.',
        verificationMethod: 'Auth and session configuration review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The hosted auth stack requires HTTPS outside loopback development, uses secure cookies on HTTPS origins, and enables encrypted OAuth token handling.',
          [
            seededEvidence(
              'HTTPS Better Auth configuration',
              'src/lib/server/env.server.ts requires BETTER_AUTH_URL and trusted origins to use HTTPS unless they point to loopback development.',
            ),
            seededEvidence(
              'Secure session and OAuth token settings',
              'convex/betterAuth/sharedOptions.ts enables secure cookies for HTTPS origins and sets encryptOAuthTokens: true for linked account handling.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'cryptographic-storage-protections',
        label: 'Cryptographic protections are applied to managed hosted storage',
        description:
          'Managed hosted storage for protected files should use configured cryptographic protection and secure transport controls.',
        verificationMethod: 'Storage configuration review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The managed S3 storage stack uses server-side encryption and enforces SSL for hosted file storage.',
          [
            seededEvidence(
              'Encrypted managed storage configuration',
              'infra/aws-cdk/lib/malware-scan-stack.cts provisions the files bucket with S3-managed encryption, blocked public access, and enforceSSL.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'cryptographic-integrity-mechanisms',
        label: 'Cryptographic signing and hashing protect integrity-sensitive service workflows',
        description:
          'Protected file access and evidence or audit workflows should use cryptographic signing or hashing where the platform relies on integrity-sensitive artifacts.',
        verificationMethod: 'Integrity mechanism review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform uses HMAC-backed signed file access plus SHA-256-based hashing for audit and evidence integrity workflows.',
          [
            seededEvidence(
              'Signed protected file access',
              'convex/fileServing.ts creates and verifies HMAC-backed signatures for protected file-serving URLs.',
            ),
            seededEvidence(
              'Evidence and audit hashing',
              'convex/security.ts and convex/audit.ts compute content, export, and audit event hashes to preserve integrity-linked records.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'provider-cryptography-standard-selection-documented',
        label: 'Provider cryptography standard selection is documented',
        description:
          'The provider should document which cryptographic uses are required in the hosted service and which approved cryptographic approaches or standards are expected for those uses.',
        verificationMethod: 'Cryptography policy and standards review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo shows cryptographic mechanisms in use, but it does not attach a provider-owned cryptography standard-selection or approved-module policy to this workspace.',
          [],
          'Infrastructure and Platform Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for evaluating whether the hosted service cryptographic posture satisfies their own policy, procurement, and regulatory requirements, including any expectations for approved cryptographic modules, customer-managed keys, or encryption requirements in connected systems they operate outside the hosted service boundary.',
  },
  {
    nist80053Id: 'SC-28',
    internalControlId: 'CTRL-SC-028',
    implementationSummary:
      'This control ensures information stored within the service boundary is protected against unauthorized access or alteration at rest. The platform addresses that objective through managed encrypted storage, blocked public access, and controlled file access for data managed within the service boundary.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Data Protection',
    hipaaCitations: ['45 CFR 164.312(a)(2)(iv)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'storage-protection',
        label: 'Hosted storage protections are configured',
        description:
          'Data at rest protections must be configured for hosted storage within the service boundary.',
        verificationMethod: 'Storage configuration review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Managed storage configuration enforces blocked public access, server-side encryption, and versioning for protected data at rest.',
          [
            seededEvidence(
              'Encrypted S3 storage configuration',
              'infra/aws-cdk/lib/malware-scan-stack.cts provisions an S3 bucket with BLOCK_ALL public access, S3-managed encryption, enforceSSL, object ownership enforcement, and versioning.',
            ),
          ],
          'Data Protection',
        ),
      },
      {
        itemId: 'at-rest-access-paths-controlled',
        label: 'Access to stored protected files is controlled',
        description:
          'Access to stored protected files should rely on controlled serve paths rather than open object access.',
        verificationMethod: 'Stored file access path review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Protected files are served through controlled signed paths instead of open storage object access.',
          [
            seededEvidence(
              'Controlled protected file access',
              'convex/storagePlatform.ts and convex/fileServing.ts route protected file access through signed serve paths instead of direct open object reads.',
            ),
          ],
          'Data Protection',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for governing exported data, retention obligations they impose on platform use, and any external storage or integrations they control.',
  },
  {
    nist80053Id: 'SI-4',
    internalControlId: 'CTRL-SI-004',
    implementationSummary:
      'This control ensures the hosted service collects and retains security-relevant monitoring signals that can support detection review and follow-up. The platform provides document scan records, audit-integrity failure signals, and security posture summaries for provider review, but provider alert response procedures are not yet evidenced in this register.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(c)(1)'],
    csf20Ids: ['DE.AE-02', 'DE.AE-03'],
    soc2CriterionIds: ['CC7.2'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'monitoring-signals',
        label: 'Hosted-service monitoring signals are collected and surfaced',
        description:
          'The platform should collect and surface security-relevant monitoring signals for provider review.',
        verificationMethod: 'Telemetry and event review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Monitoring-related platform signals are collected and surfaced through document scan records, audit-integrity failures, and security posture summaries.',
          [
            seededEvidence(
              'Security monitoring signals',
              'convex/security.ts reports document scan records and security posture summaries, while convex/audit.ts records audit_integrity_check_failed events when integrity verification fails.',
            ),
          ],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'provider-alert-procedure',
        label: 'Provider alert response procedure is documented',
        description:
          'Provider alert routing and response expectations should be documented for the hosted platform.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider-owned monitoring response procedure is attached in the control workspace yet.',
          [],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'monitoring-records-retained',
        label: 'Monitoring records are retained for later review',
        description:
          'The platform should retain monitoring outputs that providers can review after signals are generated.',
        verificationMethod: 'Monitoring record review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Monitoring-related records are retained through document scan events, retention job state, and audit-integrity failure records.',
          [
            seededEvidence(
              'Document scan event records',
              'convex/schema.ts defines documentScanEvents and convex/security.ts reports their latest status, rejection counts, and quarantine counts.',
            ),
            seededEvidence(
              'Retention job records',
              'convex/schema.ts defines retentionJobs and convex/security.ts reports retention job posture for later operational review.',
            ),
            seededEvidence(
              'Audit integrity failure records',
              'convex/audit.ts emits audit_integrity_check_failed events when the audit log hash chain does not verify.',
            ),
          ],
          'Security Monitoring',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for reviewing service notifications, acting on customer-visible alerts, and integrating platform outputs into their own operational response processes.',
  },
  {
    nist80053Id: 'AC-6',
    internalControlId: 'CTRL-AC-006',
    implementationSummary:
      'This control ensures privileged access is limited to the minimum set of roles, actions, and conditions necessary for administrative or organization-scoped duties. The platform supports that objective through explicit role separation, organization-scoped permission checks, and stronger assurance requirements for elevated actions.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Identity and Access Management',
    hipaaCitations: ['45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    csf20Ids: ['PR.AA-05'],
    soc2CriterionIds: ['CC6.1', 'CC6.3'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'privileged-roles-defined',
        label: 'Privileged roles are explicitly defined and separated by responsibility',
        description:
          'Role definitions should distinguish site-admin, organization-owner, organization-admin, and member capabilities.',
        verificationMethod: 'Role model and authorization helper review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Privileged access is separated across site-admin, owner, admin, and member roles with explicit capability boundaries.',
          [
            seededEvidence(
              'Organization role and capability model',
              'src/features/organizations/lib/organization-permissions.ts defines site-admin, owner, admin, and member access boundaries.',
            ),
            seededEvidence(
              'Authorized Convex builders',
              'convex/auth/authorized.ts separates organization-scoped and site-admin query, mutation, and action wrappers.',
            ),
          ],
        ),
      },
      {
        itemId: 'least-privilege-authorization',
        label: 'Admin and organization-management actions enforce least-privilege authorization',
        description:
          'Administrative and organization-management flows must enforce the narrowest allowed action set for the acting role.',
        verificationMethod: 'Authorization path review and permission decision inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Server-side guards, authorization builders, and organization permission decisions enforce role-appropriate access before privileged actions proceed.',
          [
            seededEvidence(
              'Privileged server access guards',
              'src/features/auth/server/auth-guards.ts requires authenticated access and site-admin checks before privileged server flows.',
            ),
            seededEvidence(
              'Organization permission decision logic',
              'convex/auth/access.ts evaluates membership state, viewer role, enterprise constraints, and permission-specific access before allowing organization actions.',
            ),
          ],
        ),
      },
      {
        itemId: 'step-up-for-high-risk-actions',
        label: 'High-risk actions require additional protections such as MFA or recent step-up',
        description:
          'High-risk operations should require stronger assurance such as MFA enrollment or recent step-up verification.',
        verificationMethod: 'Auth policy and fresh-session protection review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Site-admin access requires MFA or passkeys, and sensitive actions can require recent step-up verification.',
          [
            seededEvidence(
              'MFA enforcement for site-admin access',
              'convex/auth/access.ts and src/features/auth/server/auth-guards.ts reject site-admin access when MFA or passkey requirements are not satisfied.',
            ),
            seededEvidence(
              'Recent step-up protections',
              'src/lib/shared/security-baseline.ts requires step-up for audit exports and src/features/auth/server/auth-guards.ts redirects users through the fresh-session flow when needed.',
            ),
          ],
        ),
      },
      {
        itemId: 'privileged-access-review-can-be-performed',
        label: 'Privileged access assignments can be reviewed periodically',
        description:
          'The hosted service should present role and membership information that supports periodic review of privileged access assignments.',
        verificationMethod: 'Role and membership review walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'Privileged roles and membership state are reviewable, but the workspace does not yet include a formal recurring privileged-access review record or cadence.',
          [
            seededEvidence(
              'Organization member role management interface',
              'Organization membership views present current member roles and status so customer administrators can review privileged assignments.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Administrative user role management interface',
              'Administrative user-management views present current top-level user roles and related session actions for provider review of privileged access.',
              { sufficiency: 'partial' },
            ),
          ],
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for granting roles appropriately, reviewing privileged assignments, and limiting who receives elevated access within their tenant.',
  },
  {
    nist80053Id: 'AU-9',
    internalControlId: 'CTRL-AU-009',
    implementationSummary:
      'This control ensures audit information is protected from unauthorized modification, monitored for tampering, and preserved with integrity metadata when shared or exported. The platform supports those objectives through access-controlled audit views, hash-linked audit records, integrity-linked evidence report exports, and retained release provenance records with signed-artifact hashes, while immutable retention controls beyond the application layer are not yet fully evidenced here.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Audit and Logging',
    hipaaCitations: ['45 CFR 164.312(b)', '45 CFR 164.312(c)(1)'],
    csf20Ids: ['PR.DS-10'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'audit-record-protection',
        label: 'Audit records are protected against unauthorized modification or deletion',
        description:
          'Access to audit records should be restricted and managed to reduce unauthorized modification or deletion risk.',
        verificationMethod: 'Audit access path and storage protection review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'Audit access is constrained to privileged or self-scoped queries, but immutable storage or deletion-prevention evidence beyond app-layer controls is not attached yet.',
          [
            seededEvidence(
              'Restricted audit query access',
              'convex/audit.ts limits audit-log queries so non-admin users can only read their own records.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Privileged audit export path',
              'convex/audit.ts restricts security audit export to verified site-admin users.',
              { sufficiency: 'partial' },
            ),
          ],
          'Audit and Logging',
        ),
      },
      {
        itemId: 'tamper-detection',
        label: 'Audit integrity checks detect broken hash chains or tampering conditions',
        description:
          'The audit subsystem should detect tampering conditions through integrity verification or equivalent controls.',
        verificationMethod: 'Audit integrity implementation review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Audit events are hash-linked and the platform can detect and record chain verification failures.',
          [
            seededEvidence(
              'Hash-linked audit insertion',
              'convex/audit.ts stores previousEventHash and eventHash when new audit records are inserted.',
            ),
            seededEvidence(
              'Audit integrity verification',
              'convex/audit.ts recomputes the audit chain and emits audit_integrity_check_failed when hashes do not verify.',
            ),
          ],
          'Audit and Logging',
        ),
      },
      {
        itemId: 'export-integrity-metadata',
        label: 'Audit-supporting exports preserve integrity metadata and review state',
        description:
          'Exported audit-supporting evidence should retain integrity metadata and reviewer state that can be validated later.',
        verificationMethod: 'Evidence export and schema review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence reports retain content hashes, export hashes, integrity summaries, and review metadata for later verification, and release provenance records retain signed bundle hashes and deployment outcome details.',
          [
            seededEvidence(
              'Evidence report integrity fields',
              'convex/schema.ts defines contentHash, exportHash, exportIntegritySummary, reviewStatus, reviewedAt, and reviewedByUserId on evidenceReports.',
            ),
            seededEvidence(
              'Integrity-linked export workflow',
              'convex/security.ts generates export bundles with content and export hashes, and src/routes/app/admin/security.tsx surfaces those values to reviewers.',
            ),
            seededEvidence(
              'Release provenance record workflow',
              'Release workflow records run URL, commit, signed source bundle hash, deployment result, and production DAST result as retained evidence linked to the change-control workflow.',
              { sufficiency: 'partial' },
            ),
          ],
          'Audit and Logging',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for protecting exported audit material after it leaves the service and for applying any downstream retention or immutability requirements they require.',
  },
  {
    nist80053Id: 'AU-12',
    internalControlId: 'CTRL-AU-012',
    implementationSummary:
      'This control ensures the platform generates audit records for defined security-relevant events across application and backend workflows. The platform supports that objective through a canonical event inventory and event emission across evidence, attachment and file-handling, vendor, and related security workflows.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Audit and Logging',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)'],
    csf20Ids: ['PR.PS-04'],
    soc2CriterionIds: ['CC7.2'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'audit-event-inventory',
        label: 'Security-relevant events are explicitly defined in the audit event inventory',
        description:
          'The platform should maintain an explicit inventory of audit-relevant event types.',
        verificationMethod: 'Audit event inventory review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'A shared event inventory defines the security-relevant audit events used throughout the app.',
          [
            seededEvidence(
              'Canonical auth and security event inventory',
              'src/lib/shared/auth-audit.ts enumerates authentication, organization, evidence, attachment, vendor, and step-up audit event types.',
            ),
          ],
          'Audit and Logging',
        ),
      },
      {
        itemId: 'workflow-audit-emission',
        label: 'Evidence, file-handling, vendor, and related security workflows emit audit records',
        description:
          'Documented evidence, attachment and file-handling, vendor, and related security workflows should emit audit records during normal and failed operations.',
        verificationMethod: 'Workflow-level audit emission review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Attachment inspection, evidence handling, and vendor access paths emit audit records for review.',
          [
            seededEvidence(
              'Attachment inspection audit events',
              'convex/agentChatActions.ts emits chat_attachment_scan_passed, chat_attachment_scan_failed, and chat_attachment_quarantined events.',
            ),
            seededEvidence(
              'Evidence and vendor audit events',
              'convex/security.ts emits evidence_report_generated, evidence_report_exported, and evidence_report_reviewed while convex/agentChatActions.ts emits outbound vendor access events.',
            ),
          ],
          'Audit and Logging',
        ),
      },
      {
        itemId: 'app-and-convex-audit-paths',
        label: 'Audit generation is exercised through the application and Convex server paths',
        description:
          'Audit generation should be available from client-triggered workflows and backend Convex operations.',
        verificationMethod: 'Client and backend audit path review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Both client-driven flows and backend actions route events through shared audit insertion paths.',
          [
            seededEvidence(
              'Client audit event action',
              'convex/audit.ts provides recordClientAuditEvent for authenticated client-triggered audit emission.',
            ),
            seededEvidence(
              'Backend audit insertion',
              'convex/audit.ts exposes insertAuditLog and multiple Convex actions and mutations call it during protected workflows.',
            ),
          ],
          'Audit and Logging',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for determining which exported audit records they retain externally and how those records are integrated into their broader oversight processes.',
  },
  {
    nist80053Id: 'SA-9',
    internalControlId: 'CTRL-SA-009',
    implementationSummary:
      'This control ensures externally provided services used by the hosted service are constrained by approved boundary expectations, permitted data classes, and auditable usage. The platform supports that objective through an internal vendor boundary registry, environment and data-class policy enforcement, and audit events for vendor use or denial. Formal subprocessor disclosures, contractual commitments, and broader supplier due diligence remain outside this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Vendor Risk Management',
    hipaaCitations: ['45 CFR 164.308(b)(1)', '45 CFR 164.308(a)(1)(ii)(A)'],
    csf20Ids: ['ID.AM-02'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'vendor-inventory-and-data-classes',
        label: 'External services are inventoried with approved data classes',
        description:
          'Approved external services should be recorded with the categories of data they are permitted to handle, while broader legal subprocessor records live elsewhere.',
        verificationMethod: 'Vendor boundary registry review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The repo models approved vendors, environments, and allowed data classes, but it is not yet a full buyer-facing subprocessor register with legal and assurance metadata.',
          [
            seededEvidence(
              'Vendor boundary registry',
              'src/lib/shared/vendor-boundary.ts inventories approved vendors, allowed data classes, allowed environments, and approval flags.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Runtime vendor posture snapshot',
              'src/lib/server/vendor-boundary.server.ts exposes vendor approval status, allowed data classes, and environment posture for review surfaces.',
              { sufficiency: 'partial' },
            ),
          ],
          'Vendor Risk Management',
        ),
      },
      {
        itemId: 'vendor-egress-policy',
        label: 'Outbound access to vendors is constrained by policy and environment',
        description:
          'Outbound service use should be constrained by allowed environments, approval gates, and permitted data classes.',
        verificationMethod: 'Vendor boundary enforcement review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Vendor egress is blocked when the vendor is not approved, the environment is not allowed, or the data classes exceed policy.',
          [
            seededEvidence(
              'Vendor boundary enforcement helper',
              'src/lib/server/vendor-boundary.server.ts rejects outbound access when vendor approval, environment, or data-class policy is not satisfied.',
            ),
            seededEvidence(
              'Outbound service call guardrails',
              'src/lib/server/openrouter.ts and convex/emails.ts invoke assertVendorBoundary before outbound vendor access.',
            ),
          ],
          'Vendor Risk Management',
        ),
      },
      {
        itemId: 'vendor-usage-auditable',
        label: 'Vendor usage and denials are auditable',
        description:
          'Successful and denied vendor use should emit reviewable records showing whether policy conditions were met.',
        verificationMethod: 'Vendor audit event review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Vendor use and denial conditions are recorded as audit events for later review.',
          [
            seededEvidence(
              'Vendor access audit event inventory',
              'src/lib/shared/auth-audit.ts defines outbound_vendor_access_used and outbound_vendor_access_denied audit event types.',
            ),
            seededEvidence(
              'Vendor use and denial event emission',
              'convex/agentChatActions.ts records outbound vendor access used and denied events during chat generation workflows.',
            ),
          ],
          'Vendor Risk Management',
        ),
      },
      {
        itemId: 'external-service-approval-state-can-be-reviewed',
        label: 'External-service approval state and review context can be reviewed',
        description:
          'The hosted service should present current approval state and review context for approved external services so providers can validate whether vendor use remains authorized.',
        verificationMethod: 'Vendor posture review walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace presents vendor approval state, approval source, allowed data classes, and environment restrictions for configured external services.',
          [
            seededEvidence(
              'Site admin vendor posture interface',
              'Administrative vendor posture cards show current approval state, approval source, allowed data classes, and allowed environments for configured services.',
            ),
            seededEvidence(
              'Vendor boundary posture data',
              'Vendor posture records include approval flags, approval source, data-class limits, and environment restrictions used during provider review.',
            ),
          ],
          'Vendor Risk Management',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations remain responsible for their own vendor due diligence, contract review, and deciding whether the platform vendor set satisfies their subprocessor and business-associate requirements.',
  },
  {
    nist80053Id: 'SA-22',
    internalControlId: 'CTRL-SA-022',
    implementationSummary:
      'This control addresses identification and handling of unsupported or deprecated managed components used by the hosted service. The platform currently supports that objective through code-health audit workflows, curated model inventory metadata with deprecation state, and site admin visibility into deprecated managed models, but a formal provider unsupported-component review cadence, replacement plan process, and exception workflow are not yet evidenced in this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Secure Engineering',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(B)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'deprecated-managed-components-can-be-identified',
        label: 'Deprecated managed components can be identified in provider-managed inventories',
        description:
          'The provider should be able to identify deprecated or retired managed components used by the hosted service where those components are tracked in provider-managed inventories.',
        verificationMethod: 'Managed component inventory review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo tracks deprecation state and optional retirement dates for curated managed models imported into the hosted service catalog.',
          [
            seededEvidence(
              'Imported model deprecation metadata',
              'convex/adminModelImports.ts marks imported models deprecated when expiration metadata is present and stores deprecation date information.',
            ),
            seededEvidence(
              'Managed model schema support',
              'convex/schema.ts includes deprecated and deprecationDate fields for provider-managed model catalog entries.',
            ),
          ],
          'Secure Engineering',
        ),
      },
      {
        itemId: 'deprecated-component-status-is-visible-to-site-admin',
        label: 'Site admin can review deprecated status for tracked managed components',
        description:
          'The hosted service should surface deprecated status for tracked managed components so site admins can review and act on those conditions.',
        verificationMethod: 'Site admin managed-component review walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin model catalog UI displays deprecated state and deprecation dates for tracked managed models.',
          [
            seededEvidence(
              'Model catalog deprecated badge',
              'src/features/admin/components/ModelCatalogManager.tsx renders deprecated badges and deprecation date fields for provider-managed model entries.',
            ),
            seededEvidence(
              'Model catalog editing surface',
              'src/features/admin/components/ModelCatalogManager.tsx allows site admins to review and update deprecated state for curated managed models.',
            ),
          ],
          'Secure Engineering',
        ),
      },
      {
        itemId: 'unsupported-component-risk-review-artifacts-exist',
        label: 'Unsupported-component risk review artifacts exist for provider follow-up',
        description:
          'The provider should have reviewable artifacts that help identify unsupported or risky implementation patterns in the hosted service codebase.',
        verificationMethod: 'Engineering audit workflow review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The repo includes automated code-health audit workflows and inventory outputs that support engineering review, but those workflows are not a full unsupported-component replacement program.',
          [
            seededEvidence(
              'Code-health audit workflow',
              'package.json defines audit:code-health and related check commands that run the code-health audit as part of provider engineering review.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Code-health audit script',
              'scripts/code-health-audit.ts provides check and inventory modes for provider review of exported Convex functions and related implementation risk conditions.',
              { sufficiency: 'partial' },
            ),
          ],
          'Secure Engineering',
        ),
      },
      {
        itemId: 'provider-unsupported-component-replacement-workflow-documented',
        label: 'Provider unsupported-component review and replacement workflow is documented',
        description:
          'The provider should document how unsupported or deprecated components are reviewed, approved for continued use or replacement, and retired from the hosted service.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a formal provider review cadence, exception workflow, or replacement plan process for unsupported components.',
          [],
          'Secure Engineering',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for tracking unsupported components in their own endpoints, identity providers, integrations, and downstream systems connected to the hosted service, and for evaluating whether any provider-managed deprecated components disclosed through the workspace satisfy their internal risk requirements.',
  },
  {
    nist80053Id: 'SC-7',
    internalControlId: 'CTRL-SC-007',
    implementationSummary:
      'This control ensures protected functions, files, and tenant-scoped resources are only accessible through approved boundary paths. The platform supports that objective through trusted-origin validation, signed file-serving paths, scoped storage access checks, and organization-boundary authorization logic.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure and Platform Security',
    hipaaCitations: ['45 CFR 164.312(a)(1)', '45 CFR 164.312(e)(1)'],
    csf20Ids: ['PR.DS-02', 'PR.DS-10', 'PR.IR-01'],
    soc2CriterionIds: ['CC6.6', 'CC6.7'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'trusted-origin-checks',
        label: 'Trusted-origin and boundary checks restrict inbound access to approved origins',
        description:
          'Authentication and other boundary-sensitive request paths should reject unapproved origins and malformed boundary configuration.',
        verificationMethod: 'Origin validation and auth middleware review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The auth layer fails closed on invalid origin configuration and rejects requests from untrusted origins before credential handling.',
          [
            seededEvidence(
              'Trusted-origin validation helpers',
              'src/lib/server/env.server.ts validates BETTER_AUTH_URL, preview hosts, and trusted origins as canonical approved origins.',
            ),
            seededEvidence(
              'Auth middleware origin rejection',
              'convex/betterAuth/sharedOptions.ts rejects authentication requests from untrusted origins before processing credentials.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'signed-boundary-crossings',
        label: 'Signed file-serving and scoped access paths protect boundary crossings',
        description:
          'Boundary-crossing file access should rely on signatures and scoped authorization rather than open object access.',
        verificationMethod: 'File-serving and signed URL review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'File serving requires scoped read authorization and signed serve URLs, and quarantined files are blocked.',
          [
            seededEvidence(
              'Signed file-serving implementation',
              'convex/fileServing.ts signs serve URLs with HMAC and blocks quarantined or infected files before redirecting to storage.',
            ),
            seededEvidence(
              'Scoped storage read authorization',
              'convex/auth/access.ts resolves storage read access and logs authorization denial before rejecting unauthorized reads.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'tenant-and-admin-boundaries',
        label: 'Tenant and admin boundaries prevent unauthorized cross-scope access',
        description:
          'Tenant-scoped and admin-scoped operations should reject unauthorized cross-scope access and route privileged operations through the correct boundary.',
        verificationMethod: 'Tenant authorization and SCIM path review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Organization membership, viewer role, and admin wrappers constrain cross-scope access, including SCIM management boundaries.',
          [
            seededEvidence(
              'Tenant and viewer-role permission decisions',
              'convex/auth/access.ts resolves organization permission decisions using membership, viewer role, and enterprise access requirements.',
            ),
            seededEvidence(
              'Org-scoped SCIM boundary controls',
              'convex/betterAuth/sharedOptions.ts blocks direct Better Auth SCIM deletion and routes SCIM management through org-scoped access checks.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for boundary controls in their own networks, browsers, devices, and downstream integrations that connect to the hosted service.',
  },
  {
    nist80053Id: 'SI-3',
    internalControlId: 'CTRL-SI-003',
    implementationSummary:
      'This control ensures files entering protected workflows are inspected for unsafe characteristics and contained when suspicious or infected conditions are detected. The platform supports that objective through built-in file inspection, quarantine and rejection paths, malware-finding ingestion, and downstream containment actions on affected files.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'File and Content Security',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)', '45 CFR 164.308(a)(1)(ii)(B)'],
    csf20Ids: [],
    soc2CriterionIds: ['CC6.8'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'files-inspected-before-acceptance',
        label: 'Uploaded files are inspected before being accepted into protected workflows',
        description:
          'Protected document and attachment workflows should inspect file content characteristics before acceptance.',
        verificationMethod: 'File-inspection pipeline review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Uploaded files are inspected for type, size, and signature mismatches before protected workflows accept them.',
          [
            seededEvidence(
              'Built-in file inspection pipeline',
              'src/lib/server/file-inspection.server.ts validates file kind, size limits, and signature matches before returning accepted status.',
            ),
            seededEvidence(
              'Attachment scan event recording',
              'convex/agentChatActions.ts records document scan events for inspected attachments before downstream chat workflows continue.',
            ),
          ],
          'File and Content Security',
        ),
      },
      {
        itemId: 'quarantine-or-reject-unsafe-files',
        label: 'Suspicious or infected files are quarantined or rejected automatically',
        description:
          'Unsafe files should be quarantined or rejected automatically when inspection or malware findings indicate risk.',
        verificationMethod: 'Quarantine and rejection path review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Signature mismatches are quarantined, unsupported files are rejected, and malware findings trigger quarantine.',
          [
            seededEvidence(
              'Quarantine and rejection decisions',
              'src/lib/server/file-inspection.server.ts returns quarantined or rejected results for unsafe file conditions.',
            ),
            seededEvidence(
              'Attachment quarantine mutation flow',
              'convex/agentChatActions.ts marks affected attachments quarantined or rejected and records the reason for later review.',
            ),
          ],
          'File and Content Security',
        ),
      },
      {
        itemId: 'malware-findings-trigger-containment',
        label: 'Malware findings are recorded and can trigger downstream containment actions',
        description:
          'Malware findings should be recorded with enough context to drive downstream containment and review.',
        verificationMethod: 'Malware finding ingestion and storage review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'link'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'GuardDuty malware findings are verified, recorded, and used to mark files infected and quarantine them.',
          [
            seededEvidence(
              'Signed GuardDuty webhook verification',
              'convex/storageWebhook.ts verifies webhook signatures and timestamps before applying GuardDuty malware findings.',
            ),
            seededEvidence(
              'Malware finding persistence',
              'convex/schema.ts stores malware status, finding IDs, and quarantine timestamps on storageLifecycle records used for containment and review.',
            ),
            seededEvidence(
              'Malware scanning infrastructure',
              'infra/aws-cdk/lib/malware-scan-stack.cts provisions the GuardDuty malware protection plan, result forwarding Lambda, and protected S3 bucket.',
            ),
          ],
          'File and Content Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for broader endpoint and email malware defenses outside the hosted file-ingest paths provided by the platform.',
  },
  {
    nist80053Id: 'CM-2',
    internalControlId: 'CTRL-CM-002',
    implementationSummary:
      'This control ensures the hosted service maintains a current baseline configuration foundation for tenant-facing security settings and core auth or session posture. The platform supports that objective through centrally defined regulated defaults, automatic baseline enforcement in organization policy state, and site-admin-visible baseline posture summaries, but a formal provider baseline review and approval procedure is not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Configuration Management',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(B)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['PR.IP-01'],
    soc2CriterionIds: ['CC8.1'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'baseline-defaults-defined',
        label: 'Baseline security defaults are defined centrally',
        description:
          'The provider should define baseline security defaults for tenant-facing policy and core session posture in a single maintained source of truth.',
        verificationMethod: 'Baseline constant and config source review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo defines a regulated baseline for retention, MFA, verified email, step-up, and related tenant-facing defaults in shared source modules.',
          [
            seededEvidence(
              'Central regulated baseline defaults',
              'src/lib/shared/security-baseline.ts defines always-on baseline requirements, retention defaults, and organization policy defaults for the hosted service baseline.',
            ),
            seededEvidence(
              'Retention baseline config defaults',
              'src/lib/server/security-config.server.ts derives retention and recent-step-up defaults from the shared regulated baseline configuration.',
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'baseline-materialized-under-configuration-control',
        label: 'Baseline defaults are materialized and preserved in organization policy state',
        description:
          'The hosted service should apply baseline defaults consistently when organization policy state is created or updated.',
        verificationMethod: 'Organization policy enforcement review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Organization policy state is normalized through the always-on regulated baseline so protected defaults remain enforced when policy values are read or updated.',
          [
            seededEvidence(
              'Baseline application during policy reads',
              'convex/organizationManagement.ts uses applyAlwaysOnRegulatedBaseline so organization policy state always reflects the enforced baseline.',
            ),
            seededEvidence(
              'Baseline application during policy updates',
              'convex/organizationManagement.ts applies applyAlwaysOnRegulatedBaseline before inserting or patching organization policy records.',
            ),
            seededEvidence(
              'Server-side policy defaults',
              'src/features/organizations/server/organization-management.ts uses regulated organization policy defaults in server-side policy handling.',
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'baseline-posture-can-be-reviewed',
        label: 'Baseline posture can be reviewed in provider and tenant surfaces',
        description:
          'The hosted service should surface the effective baseline posture so site admins and organization administrators can review the enforced defaults.',
        verificationMethod: 'UI and evidence export walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The app surfaces enforced baseline posture in organization settings and site-admin security evidence outputs.',
          [
            seededEvidence(
              'Organization policy baseline surface',
              'src/features/organizations/components/OrganizationPoliciesCard.tsx presents always-enforced regulated controls alongside editable access policies.',
            ),
            seededEvidence(
              'Site admin baseline summary',
              'convex/security.ts includes baseline defaults, session policy, and verification posture in generated site-admin evidence data for review.',
            ),
            seededEvidence(
              'Site admin baseline UI summary',
              'src/routes/app/admin/security.tsx renders session and security posture summary values derived from the site-admin security workspace.',
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'provider-baseline-review-procedure-documented',
        label: 'Provider baseline review and update procedure is documented',
        description:
          'The provider should document how the hosted-service baseline configuration is reviewed, approved, and updated when components or requirements change.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a formal provider procedure for baseline review cadence, approval, or update triggers.',
          [],
          'Configuration Management',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for reviewing whether the hosted-service baseline aligns with their own local configuration standards and for governing any customer-managed integrations, endpoints, or downstream configurations outside the hosted service boundary.',
  },
  {
    nist80053Id: 'CM-6',
    internalControlId: 'CTRL-CM-006',
    implementationSummary:
      'This control ensures regulated security settings are defined centrally and enforced consistently across the hosted service. The platform supports that objective through centrally defined regulated defaults, fail-closed auth configuration validation, and explicit secure session settings in the auth runtime.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Secure Configuration',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(B)', '45 CFR 164.312(d)'],
    csf20Ids: ['PR.PS-01'],
    soc2CriterionIds: ['CC6.1'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'regulated-defaults-defined',
        label: 'Regulated security defaults are defined centrally and enforced consistently',
        description:
          'Regulated baseline defaults should be defined centrally and applied consistently to tenant-facing policy settings.',
        verificationMethod: 'Security baseline constant review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The regulated baseline centralizes retention, MFA, verification, and step-up defaults for protected service behavior.',
          [
            seededEvidence(
              'Central regulated baseline defaults',
              'src/lib/shared/security-baseline.ts defines regulated retention defaults, always-on baseline requirements, and organization policy defaults.',
            ),
          ],
          'Secure Configuration',
        ),
      },
      {
        itemId: 'fail-closed-auth-config',
        label:
          'Authentication and session settings fail closed when insecure configuration is supplied',
        description:
          'Auth and session configuration should reject insecure or malformed settings instead of silently degrading security.',
        verificationMethod: 'Runtime config validation review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The auth runtime rejects malformed origins and enforces secure session configuration for regulated deployments, and the verification workflow can retain reviewable records of those checks in the control workspace.',
          [
            seededEvidence(
              'Fail-closed Better Auth env validation',
              'Runtime validation rules describing how invalid Better Auth origins, preview hosts, and trusted-origin settings are rejected before protected authentication paths start.',
            ),
            seededEvidence(
              'Explicit secure session settings',
              'Authentication configuration describing explicit session expiry, refresh, freshness, database-backed session storage, and cookie-cache behavior for security-sensitive revocation flows.',
            ),
            seededEvidence(
              'Retained Better Auth verification workflow record',
              'Workflow record that can be retained in the control workspace for a manual Better Auth verification run, including the GitHub Actions run reference and step outcomes for build, startup, health, and verification checks.',
            ),
          ],
          'Secure Configuration',
        ),
      },
      {
        itemId: 'runtime-security-config-validated',
        label: 'Security-sensitive runtime configuration is validated before the app starts',
        description:
          'Security-sensitive runtime settings should be validated during startup so unsafe configuration is rejected early.',
        verificationMethod: 'Runtime configuration validation review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Security-sensitive runtime configuration is validated for auth origins and vendor configuration before protected paths proceed.',
          [
            seededEvidence(
              'Auth and site URL validation',
              'src/lib/server/env.server.ts validates security-sensitive auth and site URL inputs as canonical origins before use.',
            ),
            seededEvidence(
              'Vendor runtime validation',
              'src/lib/server/openrouter.ts validates OpenRouter privacy mode and API key presence before outbound model use.',
            ),
          ],
          'Secure Configuration',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for safe configuration of any customer-controlled integrations, identity providers, or downstream policies they connect to the platform.',
  },
  {
    nist80053Id: 'CM-8',
    internalControlId: 'CTRL-CM-008',
    implementationSummary:
      'This control ensures the hosted service maintains a partial inventory foundation for the components and managed services that make up the deployed system boundary. The platform currently documents architecture scope, approved external services, and selected security-relevant managed components, but a complete component inventory with formal review cadence and accountability records is not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Configuration Management',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)'],
    csf20Ids: ['ID.AM-02'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'architecture-and-service-boundary-components-documented',
        label: 'Architecture and service-boundary components are documented',
        description:
          'The provider should document the major application, runtime, and service-boundary components that make up the hosted system.',
        verificationMethod: 'Architecture artifact review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Architecture and control-matrix documentation identify the major hosted-service layers, runtime boundaries, and deployer-owned gaps.',
          [
            seededEvidence(
              'Architecture overview',
              'docs/ARCHITECTURE.md documents the application shell, server-function boundaries, Convex runtime, authentication stack, and high-level service architecture.',
            ),
            seededEvidence(
              'Control matrix boundary narrative',
              'docs/CONTROL_MATRIX.md describes which safeguards and managed components are in app scope versus which infrastructure and operational elements remain deployer-owned.',
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'approved-external-services-and-managed-components-inventoried',
        label: 'Approved external services and selected managed components are inventoried',
        description:
          'The provider should maintain an inventory of approved external services and selected security-relevant managed components within the hosted system boundary.',
        verificationMethod: 'Service and managed-component inventory review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The repo inventories approved external services and documents selected security-relevant managed components, but it is not yet a complete component inventory for the full hosted environment.',
          [
            seededEvidence(
              'Vendor boundary registry',
              'src/lib/shared/vendor-boundary.ts inventories approved external services, allowed data classes, allowed environments, and approval flags.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Vendor posture snapshot',
              'src/lib/server/vendor-boundary.server.ts materializes current approval posture for configured external services.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Managed malware-scan stack definition',
              'infra/aws-cdk/lib/malware-scan-stack.cts defines the files bucket, GuardDuty malware protection plan, EventBridge rule, and forwarding Lambda used for the hosted document-scanning path.',
              { sufficiency: 'partial' },
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'component-posture-can-be-reviewed-in-site-admin',
        label: 'Site admin can review current posture for inventoried external services',
        description:
          'The hosted service should expose current posture for inventoried external services so site admins can review configured approval state and allowed use.',
        verificationMethod: 'Site admin posture walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace surfaces current approval posture and allowed data classes for configured external services.',
          [
            seededEvidence(
              'Vendor posture query',
              'convex/security.ts includes vendor posture from the vendor-boundary snapshot in the site-admin security workspace data.',
            ),
            seededEvidence(
              'Vendor posture site admin UI',
              'src/routes/app/admin/security.tsx renders vendor posture cards showing approval state, approval source, and allowed data classes for configured services.',
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'inventory-records-include-environment-and-lifecycle-context',
        label:
          'Inventory records include environment, approval, and lifecycle context where tracked',
        description:
          'Provider inventory records should include the environment, approval context, and lifecycle state of tracked components or services where that information is available.',
        verificationMethod: 'Inventory record review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'Vendor and managed-component inventory records include environment, approval, and some lifecycle context, but they do not yet form a complete accountable system inventory.',
          [
            seededEvidence(
              'Vendor boundary inventory records',
              'Vendor inventory records include approval flags, approval source, allowed environments, and allowed data classes for configured external services.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Managed component lifecycle records',
              'Managed model catalog records retain deprecated state and optional deprecation dates for tracked provider-managed components.',
              { sufficiency: 'partial' },
            ),
          ],
          'Configuration Management',
        ),
      },
      {
        itemId: 'provider-component-inventory-review-procedure-documented',
        label: 'Provider component inventory review procedure is documented',
        description:
          'The provider should document how the hosted-service component inventory is reviewed, updated, and kept current over time.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider-owned review cadence or update procedure for a full system component inventory is attached in the repo-backed control workspace yet.',
          [],
          'Configuration Management',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for maintaining inventories of their own endpoints, integrations, identity providers, and any customer-managed infrastructure or downstream systems connected to the hosted service.',
  },
  {
    nist80053Id: 'SI-7',
    internalControlId: 'CTRL-SI-007',
    implementationSummary:
      'This control ensures important service data and content flows retain integrity signals that help detect mismatches, tampering, or unsafe alteration. The platform supports that objective through file signature validation, hash-linked audit records, signed release artifacts, and integrity-linked evidence and signed file-serving flows.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Integrity Assurance',
    hipaaCitations: ['45 CFR 164.312(c)(1)', '45 CFR 164.312(b)'],
    csf20Ids: ['PR.PS-02'],
    soc2CriterionIds: ['CC6.8'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'file-signature-integrity',
        label: 'File type and signature validation protect against content integrity mismatches',
        description:
          'Protected file workflows should validate content signatures against declared type or extension expectations.',
        verificationMethod: 'File integrity inspection review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'File inspection validates content signatures and quarantines mismatches before protected processing continues.',
          [
            seededEvidence(
              'Signature and kind validation',
              'src/lib/server/file-inspection.server.ts resolves known file kinds and checks signatures before accepting files.',
            ),
          ],
          'Integrity Assurance',
        ),
      },
      {
        itemId: 'audit-hash-integrity',
        label: 'Audit data integrity is verified through chained hashes or equivalent controls',
        description:
          'Audit records should carry linked integrity values and be verifiable after creation.',
        verificationMethod: 'Audit integrity mechanism review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Audit events are linked through chained hashes and regularly verifiable through a dedicated integrity check path.',
          [
            seededEvidence(
              'Audit hash chain',
              'convex/audit.ts computes eventHash values using previousEventHash so audit records form a verifiable chain.',
            ),
            seededEvidence(
              'Audit chain verification action',
              'convex/audit.ts provides verifyAuditIntegrityInternal to recompute hashes and detect integrity failures.',
            ),
          ],
          'Integrity Assurance',
        ),
      },
      {
        itemId: 'integrity-protected-exports-and-access',
        label:
          'Integrity-protecting mechanisms exist for exported evidence and signed file access flows',
        description:
          'Evidence exports and signed file access paths should include integrity-preserving metadata or signatures that can be validated later.',
        verificationMethod: 'Evidence export and signed file access review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence exports preserve content and export hashes, signed release bundles are verified before upload, and signed file-serving paths protect storage access flows.',
          [
            seededEvidence(
              'Evidence export integrity metadata',
              'convex/security.ts computes contentHash and exportHash values and stores exportIntegritySummary for evidence report exports.',
            ),
            seededEvidence(
              'Signed release bundle workflow',
              'Creates and verifies a signed source bundle artifact set for later review.',
            ),
            seededEvidence(
              'Signed file serve URLs',
              'convex/fileServing.ts generates HMAC-backed signed serve URLs for protected file access.',
            ),
          ],
          'Integrity Assurance',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for validating the integrity of any exported material after it leaves the service and for protecting customer-managed downstream storage or transmission paths.',
  },
  {
    nist80053Id: 'CA-2',
    internalControlId: 'CTRL-CA-002',
    implementationSummary:
      'This control ensures the hosted service can generate and retain structured control assessment outputs for provider review. The platform supports that objective through evidence report generation, review-state retention, and exportable assessment artifacts in the site admin workspace, but a formal provider assessment plan, assessor assignment model, and approval workflow are not yet evidenced in this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Assurance',
    hipaaCitations: ['45 CFR 164.308(a)(8)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'assessment-artifacts-generated',
        label: 'Structured control assessment artifacts can be generated',
        description:
          'The hosted service should generate structured assessment outputs from current control and posture state for provider review.',
        verificationMethod: 'Evidence report generation walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace can generate structured evidence reports from current posture, audit readiness, and control workspace state.',
          [
            seededEvidence(
              'Evidence report generation action',
              'convex/security.ts generates structured evidence reports from posture state, recent audit events, integrity checks, and control workspace data.',
            ),
            seededEvidence(
              'Site admin report generation UI',
              'src/routes/app/admin/security.tsx exposes Generate evidence report and Generate audit readiness report actions in the site admin workspace.',
            ),
            seededEvidence(
              'Control matrix operational evidence note',
              'docs/CONTROL_MATRIX.md documents that evidence report generation persists structured evidence snapshots for compliance-ready exports.',
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'assessment-results-reviewed-and-retained',
        label: 'Assessment results can be reviewed and retained with reviewer attribution',
        description:
          'Assessment outputs should retain review status, reviewer identity, notes, and timestamps for later provider review.',
        verificationMethod: 'Evidence report review workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Generated assessment artifacts retain review state, reviewer attribution, and notes in the site admin workspace.',
          [
            seededEvidence(
              'Evidence report review metadata schema',
              'convex/schema.ts defines reviewStatus, reviewedAt, reviewedByUserId, reviewNotes, contentHash, and exportHash fields on evidence reports.',
            ),
            seededEvidence(
              'Evidence report review mutation',
              'convex/security.ts records review status and reviewer attribution for persisted evidence reports.',
            ),
            seededEvidence(
              'Site admin review workflow',
              'src/routes/app/admin/security.tsx allows site admins to mark evidence reports reviewed or needing follow-up with reviewer notes.',
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'assessment-results-exportable',
        label: 'Assessment results can be exported for designated reviewers',
        description:
          'The hosted service should export assessment artifacts with integrity metadata so provider reviewers can share results with designated recipients.',
        verificationMethod: 'Evidence report export review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence reports can be exported with manifest and integrity metadata from the site admin workspace.',
          [
            seededEvidence(
              'Evidence report export action',
              'convex/security.ts packages report content, manifest data, contentHash, exportHash, and exportIntegritySummary for evidence report export.',
            ),
            seededEvidence(
              'Export artifact storage',
              'convex/schema.ts defines export artifacts with manifestHash, payloadHash, sourceReportId, and exportedByUserId for evidence report exports.',
            ),
            seededEvidence(
              'Site admin export UI',
              'src/routes/app/admin/security.tsx exposes export actions and displays content and export hashes for evidence reports.',
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'provider-assessment-plan-documented',
        label: 'Provider control assessment plan and approval workflow is documented',
        description:
          'The provider should document assessment scope, reviewer roles, approval expectations, and recurring assessment cadence for the hosted service.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a formal provider assessment plan, assessor assignment record, or approval workflow for recurring control assessments.',
          [],
          'Security Assurance',
        ),
      },
    ],
    customerResponsibilityNotes:
      "Customer organizations are responsible for conducting their own assessments of customer-managed configurations, local integrations, and operational procedures outside the hosted service boundary. Any exported assessment artifacts should be reviewed according to the customer's internal governance process.",
  },
  {
    nist80053Id: 'CA-5',
    internalControlId: 'CTRL-CA-005',
    implementationSummary:
      'This control ensures the hosted service can surface, retain, and export follow-up items that support provider remediation tracking after control or readiness reviews. The platform supports that objective through audit-readiness findings, evidence-report follow-up state, retained reviewer notes, and evidence activity history in the site admin workspace, but a formal provider plan-of-action workflow with assigned milestones, target dates, and approval records is not yet evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Assurance',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(B)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['GV.RM-01'],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'follow-up-findings-can-be-surfaced',
        label: 'Provider follow-up findings can be surfaced from readiness and control reviews',
        description:
          'The hosted service should surface review findings that providers may need to investigate or remediate after control and audit-readiness review.',
        verificationMethod: 'Site admin findings and readiness review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace surfaces metadata gaps, authorization denials, and generated review artifacts that can drive provider follow-up.',
          [
            seededEvidence(
              'Audit readiness findings surface',
              'src/routes/app/admin/security.tsx renders metadata gaps, authorization denials, manifest history, and backup drill evidence in the site admin audit-readiness view.',
            ),
            seededEvidence(
              'Operational readiness note',
              'docs/CONTROL_MATRIX.md documents that the site admin security workspace exposes internal operational evidence and deployer-owned gaps for review.',
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'follow-up-state-and-review-notes-retained',
        label: 'Follow-up state and reviewer notes can be retained on assessment artifacts',
        description:
          'Assessment and review artifacts should retain follow-up state, reviewer attribution, and notes for later provider action.',
        verificationMethod: 'Evidence report review workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence reports retain pending, reviewed, or needs-follow-up state with reviewer notes and reviewer attribution.',
          [
            seededEvidence(
              'Evidence report follow-up metadata schema',
              'convex/schema.ts defines reviewStatus, reviewNotes, reviewedAt, and reviewedByUserId on evidence reports, including the needs follow-up state.',
            ),
            seededEvidence(
              'Evidence report follow-up workflow',
              'convex/security.ts persists reviewed or needs follow-up state with trimmed reviewer notes, and src/routes/app/admin/security.tsx exposes the review queue actions.',
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'follow-up-evidence-history-retained',
        label: 'Evidence changes and review history can be retained for follow-up tracking',
        description:
          'The hosted service should retain evidence activity history so providers can review how supporting artifacts changed during follow-up work.',
        verificationMethod: 'Evidence activity history review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Evidence creation, review, archival, and renewal activity is retained and surfaced in the site admin workspace for follow-up tracking.',
          [
            seededEvidence(
              'Evidence activity storage and query path',
              'convex/schema.ts defines security control evidence activity and convex/security.ts lists evidence activity history by control and checklist item.',
            ),
            seededEvidence(
              'Evidence activity history UI',
              'src/routes/app/admin/security.tsx renders evidence activity history showing review, archive, and renewal events in the evidence history dialog.',
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'follow-up-owners-dates-and-milestones-can-be-recorded',
        label:
          'Follow-up owners, dates, and milestone expectations can be retained with action artifacts',
        description:
          'The workspace should retain provider notes or attached artifacts that document ownership, target dates, and milestone expectations for follow-up actions.',
        verificationMethod: 'Evidence review and attachment workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The workspace retains follow-up notes, reviewer identity, and attached evidence artifacts, but it does not yet provide a dedicated milestone-tracking data model.',
          [
            seededEvidence(
              'Evidence report follow-up workflow',
              'Review records retain follow-up status and reviewer notes that can capture action ownership or target-date context as supporting artifacts.',
              { sufficiency: 'partial' },
            ),
            seededEvidence(
              'Security control evidence attachment workflow',
              'Control evidence items can be attached, reviewed, and retained with notes and history to support provider action tracking artifacts.',
              { sufficiency: 'partial' },
            ),
          ],
          'Security Assurance',
        ),
      },
      {
        itemId: 'provider-poam-workflow-documented',
        label: 'Provider plan-of-action workflow with milestones is documented',
        description:
          'The provider should document how follow-up items are converted into assigned actions, target dates, milestone tracking, and closure decisions for the hosted service.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a formal provider plan-of-action workflow with assigned owners, target dates, milestones, or closure approval records.',
          [],
          'Security Assurance',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for maintaining their own remediation plans, milestones, and closure processes for customer-managed findings in connected systems, integrations, and operational procedures outside the hosted service boundary.',
  },
  {
    nist80053Id: 'CA-7',
    internalControlId: 'CTRL-CA-007',
    implementationSummary:
      'This control ensures security-relevant posture signals are collected, summarized, and made available for recurring internal review. The platform supports that objective through a posture summary query, retained scan and retention records, audit-integrity telemetry, release verification signals, and evidence report generation from current monitoring state.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['DE.CM-01', 'DE.AE-02', 'DE.AE-03'],
    soc2CriterionIds: ['CC4.1'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'posture-signals-collected',
        label: 'Security posture signals are collected and summarized for ongoing review',
        description:
          'The platform should collect and summarize current security posture signals that operators can review repeatedly.',
        verificationMethod: 'Security posture summary review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The security posture summary aggregates authentication, scan, retention, backup, audit, telemetry, and vendor posture for review.',
          [
            seededEvidence(
              'Security posture summary query',
              'convex/security.ts aggregates posture signals for MFA coverage, backups, retention, scans, audit integrity, telemetry, and vendor posture.',
            ),
            seededEvidence(
              'Admin summary dashboard',
              'src/routes/app/admin/security.tsx renders posture summary cards for MFA, file inspection, audit integrity, retention jobs, and telemetry.',
            ),
          ],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'monitoring-output-coverage',
        label:
          'Monitoring outputs include audit integrity, file scanning, retention, and backup signals',
        description:
          'Monitoring state should include the main classes of signals needed for security posture review and follow-up.',
        verificationMethod: 'Monitoring data model review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Monitoring outputs include audit integrity failures, document scan records, retention jobs, backup verification records, and release-verification results from the deployment workflow.',
          [
            seededEvidence(
              'Monitoring evidence tables',
              'convex/schema.ts defines documentScanEvents, retentionJobs, and backupVerificationReports used by posture and review workflows.',
            ),
            seededEvidence(
              'Audit integrity monitoring signal',
              'convex/security.ts counts audit_integrity_check_failed events and includes the result in the posture summary.',
            ),
            seededEvidence(
              'Release verification workflow',
              'waits for the target Netlify release, runs post-deploy smoke checks, and runs an OWASP ZAP baseline against the production deployment before final release evidence is recorded.',
            ),
          ],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'evidence-report-from-monitoring-state',
        label: 'Reviewers can generate evidence reports from current monitoring state',
        description:
          'Current monitoring posture should be exportable into an evidence artifact suitable for recurring security review.',
        verificationMethod: 'Evidence report generation review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Reviewers can generate evidence reports from the current posture summary and supporting recent signals.',
          [
            seededEvidence(
              'Evidence report generation action',
              'convex/security.ts generates a structured evidence report from current posture state, recent audit events, integrity checks, and control workspace data.',
            ),
            seededEvidence(
              'Evidence report UI workflow',
              'src/routes/app/admin/security.tsx exposes Generate evidence report and review/export actions for current monitoring state.',
            ),
          ],
          'Security Monitoring',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for establishing review cadence, assigning reviewers, and deciding how platform monitoring outputs are incorporated into broader organizational monitoring processes.',
  },
  {
    nist80053Id: 'CM-3',
    internalControlId: 'CTRL-CM-003',
    implementationSummary:
      'This control ensures security-relevant changes are made through controlled, reviewable, and reproducible mechanisms. The platform supports that objective through gated CI checks, signed release artifacts, deployment verification steps, retained release provenance records, and reproducible compliance generation workflows, while formal approval records and provider change-management procedures are not yet fully evidenced in this workspace.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Change Management',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(B)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['PR.PS-01'],
    soc2CriterionIds: ['CC8.1'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'controlled-change-path',
        label: 'Security-relevant code and configuration changes follow a controlled change path',
        description:
          'Security-relevant changes should follow a defined, reviewable path rather than ad hoc mutation.',
        verificationMethod: 'Change workflow and repo artifact review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Release workflow jobs gate deployable branches, sign source artifacts, verify deployments, and attach release provenance records to the control workspace.',
          [
            seededEvidence(
              'Release workflow definition',
              'Defines lint, typecheck, security, test, SAST, SBOM generation, signed source bundle, deployment, and post-deploy verification steps before release completion.',
            ),
            seededEvidence(
              'Release provenance evidence recording workflow',
              'Records release run metadata, signed source bundle hash, deployment outcome, and DAST status against the change-control item in the security workspace.',
              { sufficiency: 'partial' },
            ),
          ],
          'Change Management',
        ),
      },
      {
        itemId: 'provider-change-approval-and-rollback-procedure-documented',
        label: 'Provider change approval and rollback procedure is documented',
        description:
          'The provider should document approval expectations, rollback planning, and emergency-change handling for security-relevant changes to the hosted service.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The workspace does not yet include a provider-owned change approval, rollback, or emergency-change procedure for hosted-service changes.',
          [],
          'Change Management',
        ),
      },
      {
        itemId: 'automated-guardrail-checks',
        label:
          'Automated checks validate code quality, dependency risk, and protected backend guardrails',
        description:
          'Automated checks should validate security-sensitive code paths, dependency risk, and required backend guardrails before deployment proceeds.',
        verificationMethod: 'Automated code-health audit review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Automated release checks cover code-health guardrails, dependency risk review, static analysis, and required validation before deployment jobs can proceed.',
          [
            seededEvidence(
              'Release security validation workflow',
              'Includes production dependency audit, admin audit guardrail checks, Convex boundary linting, security policy linting, Semgrep, and OSV vulnerability scanning before release preparation.',
            ),
            seededEvidence(
              'Convex function code-health audit',
              'scripts/code-health-audit.ts classifies exported Convex functions, flags unprotected public functions, and fails when return validators are missing.',
            ),
            seededEvidence(
              'Auth-protected Convex builders',
              'convex/auth/authorized.ts provides builder-level wrappers for site-admin and organization-scoped protected functions.',
            ),
          ],
          'Change Management',
        ),
      },
      {
        itemId: 'compliance-artifacts-reproducible',
        label: 'Generated compliance artifacts are reproducible from source and refresh workflows',
        description:
          'Generated compliance outputs should be reproducible from tracked sources and scripted refresh workflows.',
        verificationMethod: 'Compliance generation workflow review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The active control register and related compliance artifacts are generated from source through scripted refresh commands.',
          [
            seededEvidence(
              'Compliance refresh command chain',
              'package.json defines compliance:refresh as a scripted chain that regenerates framework extracts and the active control register from source inputs.',
            ),
            seededEvidence(
              'Generated control register source of truth',
              'scripts/compliance/generate-active-control-register.ts builds the active control register seed from framework extracts and local blueprint definitions.',
            ),
          ],
          'Change Management',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for their own approval, CAB, and deployment control processes for any customer-managed integrations or operational changes outside the hosted service boundary.',
  },
  {
    nist80053Id: 'PL-2',
    internalControlId: 'CTRL-PL-002',
    implementationSummary:
      'This control ensures the hosted service has a partial set of documented security planning artifacts for architecture, scope, and dependencies. The platform currently provides that foundation through architecture, auth-security, and control-matrix documentation, but formal plan approval and recurring review workflow evidence are not yet attached here.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Security Planning',
    hipaaCitations: [
      '45 CFR 164.308(a)(1)(ii)(A)',
      '45 CFR 164.308(a)(1)(ii)(B)',
      '45 CFR 164.316(b)(1)',
    ],
    csf20Ids: ['ID.AM-03', 'ID.AM-08'],
    soc2CriterionIds: ['CC5.3'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'system-architecture-and-context-documented',
        label: 'Architecture and service scope are documented',
        description:
          'The provider should maintain architecture and operational-context documentation for the hosted service boundary.',
        verificationMethod: 'Architecture and design-document review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Architecture and deployment-scope documentation exists for the hosted service and can anchor a lightweight system plan.',
          [
            seededEvidence(
              'Architecture overview document',
              'docs/ARCHITECTURE.md documents routing, server-function boundaries, authentication, and the high-level application architecture.',
            ),
            seededEvidence(
              'Control matrix scope narrative',
              'docs/CONTROL_MATRIX.md explains which safeguards ship in app scope versus which operational gaps remain deployer-owned.',
            ),
          ],
          'Security Planning',
        ),
      },
      {
        itemId: 'security-requirements-and-dependencies-documented',
        label: 'Security requirements and external dependencies are documented',
        description:
          'The provider should document key security requirements, external dependencies, and the scope of controls or gaps relevant to the hosted service.',
        verificationMethod: 'Security planning artifact review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo documents security requirements and external dependencies through linked security notes, control-matrix scope, and vendor-boundary definitions.',
          [
            seededEvidence(
              'Auth security baseline notes',
              'docs/AUTH_SECURITY.md documents strict auth defaults, session protections, origin validation, and deployer-owned security gaps.',
            ),
            seededEvidence(
              'Vendor dependency boundary definitions',
              'src/lib/shared/vendor-boundary.ts and src/lib/server/vendor-boundary.server.ts document approved outbound vendors, allowed data classes, and dependency boundaries.',
            ),
          ],
          'Security Planning',
        ),
      },
      {
        itemId: 'provider-plan-review-and-approval-documented',
        label: 'Provider plan review and approval workflow is documented',
        description:
          'The provider should document how the system security and privacy plan is reviewed, approved, and updated over time.',
        verificationMethod: 'Planning procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a formal provider review cadence, approval record, or update procedure for these planning artifacts.',
          [],
          'Security Planning',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for documenting their own connected environment, local data flows, user roles, and any customer-operated safeguards or procedures that sit outside the hosted service boundary.',
  },
  {
    nist80053Id: 'PS-3',
    internalControlId: 'CTRL-PS-003',
    implementationSummary:
      'This control addresses provider personnel-screening documentation for workforce members who may administer or support the hosted service. The repo-backed workspace can retain, review, and export provider evidence artifacts related to workforce security controls, but the repo does not itself evidence a formal personnel-screening policy, completed screening records, or provider approval workflow for workforce access.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Workforce Security',
    hipaaCitations: [],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'provider-personnel-screening-artifacts-can-be-retained',
        label: 'Provider personnel-screening artifacts can be retained in the site admin workspace',
        description:
          'The hosted service should allow provider workforce-security artifacts to be attached and retained for later review.',
        verificationMethod: 'Evidence workspace review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace can retain uploaded evidence artifacts and associate them with provider controls for later review.',
          [
            seededEvidence(
              'Security control evidence storage',
              'convex/schema.ts defines securityControlEvidence and related review fields used to retain uploaded evidence artifacts for site admin controls.',
            ),
            seededEvidence(
              'Site admin evidence upload and review flows',
              'convex/security.ts and src/routes/app/admin/security.tsx support attaching, reviewing, and exporting evidence for site admin controls.',
            ),
          ],
          'Workforce Security',
        ),
      },
      {
        itemId: 'provider-workforce-screening-follow-up-state-can-be-tracked',
        label: 'Provider workforce-screening evidence can retain review and follow-up state',
        description:
          'Provider workforce-security evidence should retain review status, reviewer attribution, notes, and history for later follow-up.',
        verificationMethod: 'Evidence review workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace retains review status, reviewer notes, and evidence activity history for attached control evidence.',
          [
            seededEvidence(
              'Evidence review metadata schema',
              'convex/schema.ts defines reviewStatus, reviewNotes, reviewedAt, reviewedByUserId, and evidence activity history for control evidence records.',
            ),
            seededEvidence(
              'Evidence review and history UI',
              'src/routes/app/admin/security.tsx renders evidence review actions and evidence history for control artifacts in the site admin workspace.',
            ),
          ],
          'Workforce Security',
        ),
      },
      {
        itemId: 'provider-personnel-screening-policy-documented',
        label: 'Provider personnel-screening policy is documented',
        description:
          'The provider should maintain a documented personnel-screening policy covering which workforce roles require screening before receiving administrative or support access.',
        verificationMethod: 'Policy review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a provider-owned personnel-screening policy artifact.',
          [],
          'Workforce Security',
        ),
      },
      {
        itemId: 'provider-screening-records-and-approval-workflow-documented',
        label: 'Provider screening records and approval workflow are documented',
        description:
          'The provider should retain screening records or approval artifacts showing that covered workforce members are screened before receiving relevant hosted-service access.',
        verificationMethod: 'Record and procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include completed screening records or an approval workflow for provider workforce access.',
          [],
          'Workforce Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for screening, approving, and supervising their own workforce, contractors, and support personnel who access customer-managed systems or connected workflows outside the hosted service boundary.',
  },
  {
    nist80053Id: 'PS-4',
    internalControlId: 'CTRL-PS-004',
    implementationSummary:
      'This control addresses personnel termination and related access removal for the hosted service and connected customer environment. The platform supports that objective through org-scoped member suspension and deactivation paths, SCIM deprovisioning semantics, session-context cleanup, and auditable membership lifecycle events, but formal provider and customer termination procedures remain outside this repo-backed workspace.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Workforce Access Governance',
    hipaaCitations: ['45 CFR 164.308(a)(3)(ii)(C)', '45 CFR 164.316(b)(1)'],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'org-scoped-access-removal-paths-exist',
        label: 'Org-scoped access removal paths exist for terminated or deprovisioned users',
        description:
          'The hosted service should support removing or deactivating organization access without destroying unrelated user records or other tenant memberships.',
        verificationMethod: 'Membership lifecycle and deprovisioning flow review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo supports org-scoped membership suspension, deactivation, and SCIM-driven deprovisioning without global user deletion.',
          [
            seededEvidence(
              'SCIM deprovisioning design',
              'docs/SCIM_DEPROVISIONING.md defines org-scoped deprovisioning semantics that remove or deactivate membership in one organization while preserving the user record and other org memberships.',
            ),
            seededEvidence(
              'Membership deprovisioning path',
              'convex/auth.ts deletes or deactivates the organization membership during SCIM deprovisioning and preserves the underlying user record.',
            ),
            seededEvidence(
              'Organization member status surface',
              'src/features/organizations/components/OrganizationMembersTable.tsx renders member status including suspended and deactivated states for organization administrators.',
            ),
          ],
          'Workforce Access Governance',
        ),
      },
      {
        itemId: 'terminated-access-is-cleared-from-session-context',
        label: 'Removed organization access is cleared from active session context',
        description:
          'When organization access is terminated, the hosted service should prevent lingering session context from continuing to authorize that organization.',
        verificationMethod: 'Session cleanup and deprovisioning path review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'SCIM deprovisioning clears organization access from active and enterprise session context after membership removal.',
          [
            seededEvidence(
              'Session context cleanup during deprovisioning',
              'convex/auth.ts syncs active organization session state and clears enterprise organization markers after SCIM deprovisioned membership removal.',
            ),
            seededEvidence(
              'Deprovisioning requirements',
              'docs/SCIM_DEPROVISIONING.md requires existing sessions to stop authorizing access to the removed organization immediately after org-scoped deprovisioning.',
            ),
          ],
          'Workforce Access Governance',
        ),
      },
      {
        itemId: 'termination-and-deprovisioning-events-are-auditable',
        label: 'Termination-related access changes are auditable',
        description:
          'Membership removal, suspension, deactivation, and SCIM deprovisioning events should emit reviewable audit records for provider or customer review.',
        verificationMethod: 'Audit event inventory and review surface inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Termination-related membership lifecycle changes are represented as audit events and reviewable through organization audit history.',
          [
            seededEvidence(
              'Membership lifecycle audit event inventory',
              'src/lib/shared/auth-audit.ts defines member removed, suspended, deactivated, reactivated, and SCIM deprovisioning lifecycle event types.',
            ),
            seededEvidence(
              'Organization audit review surface',
              'src/features/organizations/components/OrganizationAuditPage.tsx exposes reviewable membership and SCIM lifecycle audit history to authorized organization roles and site admins.',
            ),
            seededEvidence(
              'Existing lifecycle-control blueprint evidence',
              'scripts/compliance/generate-active-control-register.ts already seeds account lifecycle and membership audit evidence under AC-2 using the same repo-backed membership lifecycle artifacts.',
              { sufficiency: 'partial' },
            ),
          ],
          'Workforce Access Governance',
        ),
      },
      {
        itemId: 'provider-and-customer-termination-procedure-documented',
        label: 'Provider and customer termination procedures are documented',
        description:
          'The provider and each customer should document how workforce termination triggers access removal, coordination steps, timing expectations, and exception handling for connected hosted-service access.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a documented provider or customer termination procedure tied to hosted-service access removal.',
          [],
          'Workforce Access Governance',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for maintaining workforce termination and offboarding procedures, triggering identity-provider or admin-led access removal when personnel leave, and ensuring downstream systems, devices, and local credentials are revoked outside the hosted service boundary.',
  },
  {
    nist80053Id: 'PS-7',
    internalControlId: 'CTRL-PS-007',
    implementationSummary:
      'This control addresses documentation and review of provider requirements for third-party personnel who may support or administer hosted-service components through approved external services. The repo-backed workspace can document approved vendor boundaries, retain and review provider evidence artifacts, and audit vendor-use paths, but it does not itself evidence a formal third-party personnel security policy, completed screening or training records, or provider approval workflow for third-party personnel access.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p1' as const,
    owner: 'Workforce Security',
    hipaaCitations: [],
    csf20Ids: [],
    soc2CriterionIds: [],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'third-party-support-boundaries-are-documented',
        label: 'Third-party service boundaries and allowed use are documented',
        description:
          'The provider should document which approved external services may support hosted-service operations and what data classes or environments they are permitted to handle.',
        verificationMethod: 'Vendor boundary documentation review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The repo documents approved external service boundaries, allowed data classes, and environment restrictions that can anchor third-party personnel security expectations.',
          [
            seededEvidence(
              'Vendor boundary registry',
              'src/lib/shared/vendor-boundary.ts documents approved vendors, allowed data classes, allowed environments, and approval expectations for hosted-service external services.',
            ),
            seededEvidence(
              'Vendor boundary posture materialization',
              'src/lib/server/vendor-boundary.server.ts exposes current approval posture, allowed data classes, and environment restrictions for configured external services.',
            ),
          ],
          'Workforce Security',
        ),
      },
      {
        itemId: 'third-party-service-use-is-auditable',
        label: 'Third-party service use and denials are auditable',
        description:
          'The hosted service should emit reviewable records when approved external services are used or denied so provider review can verify boundary enforcement.',
        verificationMethod: 'Vendor audit event review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Vendor use and vendor denial conditions are represented as audit events and can be reviewed later in the site admin workspace.',
          [
            seededEvidence(
              'Vendor access audit event inventory',
              'src/lib/shared/auth-audit.ts defines outbound vendor access used and denied event types for review.',
            ),
            seededEvidence(
              'Vendor use and denial event emission',
              'convex/agentChatActions.ts emits outbound vendor access used and denied events during protected vendor-backed workflows.',
            ),
          ],
          'Workforce Security',
        ),
      },
      {
        itemId: 'third-party-personnel-security-artifacts-can-be-retained',
        label: 'Provider third-party personnel security artifacts can be retained and reviewed',
        description:
          'The site admin workspace should allow provider artifacts related to third-party personnel security expectations to be attached, reviewed, and retained for later follow-up.',
        verificationMethod: 'Evidence workspace review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The site admin workspace can retain uploaded evidence artifacts, review state, and evidence history for provider controls, including third-party personnel security artifacts.',
          [
            seededEvidence(
              'Security control evidence storage',
              'convex/schema.ts defines securityControlEvidence and related review fields used to retain uploaded evidence artifacts for site admin controls.',
            ),
            seededEvidence(
              'Evidence review and export flows',
              'convex/security.ts and src/routes/app/admin/security.tsx support attaching, reviewing, and exporting evidence artifacts for provider controls.',
            ),
          ],
          'Workforce Security',
        ),
      },
      {
        itemId: 'provider-third-party-personnel-security-policy-documented',
        label:
          'Provider third-party personnel security policy and approval workflow are documented',
        description:
          'The provider should document which third-party personnel require screening, training, approval, and ongoing supervision before supporting hosted-service operations or related approved external services.',
        verificationMethod: 'Policy review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'The repo-backed workspace does not yet include a provider-owned third-party personnel security policy, completed screening or training records, or approval workflow for third-party personnel access.',
          [],
          'Workforce Security',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for screening, approving, and supervising their own contractors, consultants, and third-party support personnel who access customer-managed systems, local identity providers, or connected workflows outside the hosted service boundary.',
  },
];

function flattenStatement(statement: string[]): string | null {
  if (statement.length === 0) {
    return null;
  }

  return statement.join(' ').replace(/\s+/g, ' ').trim();
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

function normalizeNistControlId(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]{2,3})-(\d+)(?:\((\d+)\))?$/);

  if (!match) {
    return null;
  }

  const [, family, controlNumber, enhancementNumber] = match;
  const normalized = `${family}-${Number.parseInt(controlNumber, 10)}`;
  return enhancementNumber
    ? `${normalized}(${Number.parseInt(enhancementNumber, 10)})`
    : normalized;
}

function getCsfControlIndex(csfMappings: CsfPayload): Record<string, CsfIndexEntry[]> {
  if (csfMappings.indexes?.nist80053) {
    return csfMappings.indexes.nist80053;
  }

  if (!csfMappings.functions) {
    return {};
  }

  return csfMappings.functions.reduce<Record<string, CsfIndexEntry[]>>((accumulator, fn) => {
    for (const category of fn.categories ?? []) {
      for (const subcategory of category.subcategories ?? []) {
        for (const reference of subcategory.informativeReferences ?? []) {
          if (
            typeof reference?.framework !== 'string' ||
            typeof reference?.reference !== 'string' ||
            !reference.framework.startsWith('SP 800-53 Rev 5')
          ) {
            continue;
          }

          const normalizedId = normalizeNistControlId(reference.reference);
          if (!normalizedId) {
            continue;
          }

          const entry: CsfIndexEntry = {
            functionId: subcategory.functionId ?? 'UNKNOWN',
            functionTitle: subcategory.functionTitle ?? 'Unknown function',
            categoryId: subcategory.categoryId ?? 'UNKNOWN',
            categoryTitle: subcategory.categoryTitle ?? 'Unknown category',
            subcategoryId: subcategory.id ?? 'UNKNOWN',
            subcategoryTitle: subcategory.title ?? 'Unknown subcategory',
          };
          const existing = accumulator[normalizedId] ?? [];
          if (!existing.some((item) => item.subcategoryId === entry.subcategoryId)) {
            existing.push(entry);
          }
          accumulator[normalizedId] = existing;
        }
      }
    }

    return accumulator;
  }, {});
}

function mapByCitation(citations: HipaaCitation[]) {
  return new Map(citations.map((citation) => [citation.citation, citation]));
}

function coverageSortValue(coverage: Coverage): number {
  switch (coverage) {
    case 'covered':
      return 0;
    case 'partial':
      return 1;
    case 'not-covered':
      return 2;
    case 'not-applicable':
      return 3;
  }
}

async function main() {
  const [moderateControls, hipaaMappings, csfMappings, nist80066Mappings, soc2Mappings] =
    await Promise.all([
      readJson<ModerateControlsPayload>(MODERATE_CONTROLS_PATH),
      readJson<HipaaPayload>(HIPAA_MAPPINGS_PATH),
      readJson<CsfPayload>(CSF_REFERENCES_PATH),
      readJson<Nist80066Payload>(NIST_80066_PATH),
      readJson<Soc2Payload>(SOC2_TSC_PATH),
    ]);

  const nistControlMap = new Map(
    moderateControls.controls.map((control) => [control.nist80053Id, control]),
  );
  const hipaaMap = mapByCitation(hipaaMappings.citations);
  const csfIndex = getCsfControlIndex(csfMappings);
  const nist80066Map = new Map(
    nist80066Mappings.citations.map((citation) => [citation.citation, citation]),
  );
  const soc2Index = soc2Mappings.indexes?.nist80053 ?? {};

  const controls = [...ACTIVE_CONTROL_BLUEPRINTS]
    .sort((left, right) => {
      const priorityCompare = left.priority.localeCompare(right.priority);
      if (priorityCompare !== 0) {
        return priorityCompare;
      }

      const coverageCompare = coverageSortValue(left.coverage) - coverageSortValue(right.coverage);
      if (coverageCompare !== 0) {
        return coverageCompare;
      }

      return left.nist80053Id.localeCompare(right.nist80053Id);
    })
    .map((blueprint) => {
      const sourceControl = nistControlMap.get(blueprint.nist80053Id);

      if (!sourceControl) {
        throw new Error(`Missing NIST 800-53 moderate control: ${blueprint.nist80053Id}`);
      }

      const platformChecklistItems = blueprint.platformChecklistItems.map((item) => ({
        ...item,
        label: normalizeChecklistLabel(item.label),
        description: normalizeChecklistDescription(item.description),
        seed: {
          ...item.seed,
          notes: normalizeBuyerFacingText(item.seed.notes),
          evidence: item.seed.evidence.map((evidence) => ({
            ...evidence,
            title: normalizeEvidenceTitle(evidence.title),
            description: normalizeEvidenceDescription(evidence.title, evidence.description),
          })),
        },
      }));

      return {
        internalControlId: blueprint.internalControlId,
        nist80053Id: sourceControl.nist80053Id,
        title: sourceControl.title,
        familyId: sourceControl.familyId,
        familyTitle: sourceControl.familyTitle,
        implementationSummary: normalizeBuyerFacingText(blueprint.implementationSummary),
        controlStatement:
          flattenStatement(sourceControl.statement) ??
          `${sourceControl.title} is tracked as an active control in the platform register.`,
        priority: blueprint.priority,
        platformChecklistItems,
        owner: blueprint.owner,
        responsibility: blueprint.responsibility,
        customerResponsibilityNotes: normalizeBuyerFacingText(
          blueprint.customerResponsibilityNotes,
        ),
        mappings: {
          hipaa: blueprint.hipaaCitations.map((citation) => {
            const record = hipaaMap.get(citation);
            if (!record) {
              throw new Error(`Missing HIPAA citation mapping for ${citation}`);
            }

            return {
              citation: record.citation,
              title: record.title,
              type: record.type,
              implementationSpecification: record.implementationSpecification,
            };
          }),
          nist80066: [
            ...blueprint.hipaaCitations
              .flatMap((citation) => {
                const reference = nist80066Map.get(citation);
                if (!reference) {
                  return [];
                }

                return [
                  {
                    referenceId: reference.referenceId,
                    label: reference.text,
                    mappingType: 'relationship' as const,
                  },
                ];
              })
              .filter(
                (mapping, index, allMappings) =>
                  allMappings.findIndex(
                    (candidate) => candidate.referenceId === mapping.referenceId,
                  ) === index,
              ),
            ...blueprint.nist80066,
          ],
          csf20: (csfIndex[sourceControl.nist80053Id] ?? [])
            .filter((entry) =>
              blueprint.csf20Ids ? blueprint.csf20Ids.includes(entry.subcategoryId) : true,
            )
            .map((entry) => ({
              subcategoryId: entry.subcategoryId,
              label: `${entry.functionId} / ${entry.categoryId}: ${entry.subcategoryTitle}`,
            })),
          soc2: (soc2Index[sourceControl.nist80053Id] ?? [])
            .filter((entry) =>
              blueprint.soc2CriterionIds
                ? blueprint.soc2CriterionIds.includes(entry.criterionId)
                : true,
            )
            .map((entry) => ({
              criterionId: entry.criterionId,
              group: entry.group,
              label: entry.title,
              trustServiceCategory: entry.trustServiceCategory,
            })),
        },
      };
    });

  const payload = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      nist80053ModerateSource: path.relative(process.cwd(), MODERATE_CONTROLS_PATH),
      hipaaSource: path.relative(process.cwd(), HIPAA_MAPPINGS_PATH),
      nist80066Source: path.relative(process.cwd(), NIST_80066_PATH),
      csf20Source: path.relative(process.cwd(), CSF_REFERENCES_PATH),
      soc2Source: path.relative(process.cwd(), SOC2_TSC_PATH),
    },
    controls,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Generated active control register seed with ${controls.length} controls.`);
}

await main();
