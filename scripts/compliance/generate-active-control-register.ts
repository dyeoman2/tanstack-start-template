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

type ReviewStatus = 'needs-follow-up' | 'pending' | 'reviewed';
type EvidenceStatus = 'fail' | 'missing' | 'not-tested' | 'pass' | 'warning';

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

function seededReview(status: ReviewStatus, notes: string | null) {
  return {
    status,
    notes,
  };
}

const ACTIVE_CONTROL_BLUEPRINTS = [
  {
    nist80053Id: 'AC-2',
    internalControlId: 'CTRL-AC-002',
    implementationSummary:
      'This control ensures accounts are authorized, role assignments are governed, and account changes remain reviewable across the account lifecycle. The platform supports that objective through role-based account boundaries, admin-managed access changes, and auditable membership events in the hosted service.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Identity and Access Management',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates platform account boundaries, access-change workflows, and audit visibility. Customer evidence is still required for workforce onboarding, offboarding, and periodic access review.',
    evidenceSources: ['Auth Users', 'Organization Membership Changes', 'Admin Audit Events'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(3)', '45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'rbac-boundaries',
        label: 'Role boundaries are enforced',
        description: 'Account roles and tenant boundaries must prevent unauthorized cross-account access.',
        verificationMethod: 'Authorization test coverage and admin workflow inspection',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Member role changes validate organization membership and require site-admin write access before mutation.',
          [
            seededEvidence(
              'Site-admin member role mutation guard',
              'convex/auth.ts enforces assertSiteAdminWriteAccess before member role updates.',
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
              'src/lib/shared/auth-audit.ts defines member_added, member_removed, and member_role_updated event types.',
            ),
            seededEvidence(
              'Organization audit review surface',
              'src/features/organizations/components/OrganizationAuditPage.tsx exposes membership-related audit history to organization owners, admins, and site admins.',
            ),
          ],
        ),
      },
    ],
    seedReview: seededReview(
      'reviewed',
      'Reviewed against member-role mutation guards and organization audit event definitions.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for workforce onboarding, termination, role assignment approval, and periodic access review.',
  },
  {
    nist80053Id: 'AC-3',
    internalControlId: 'CTRL-AC-003',
    implementationSummary:
      'This control ensures users and processes can perform only the actions and data access they are authorized to use. The platform addresses that objective through route-level and server-side authorization checks for protected application flows and sensitive operations.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Application Authorization',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'pass' as const,
    evidenceAssessmentNote:
      'Built-in route guards, server authorization checks, and test coverage provide direct support for this platform control.',
    evidenceSources: [
      'Route Guards',
      'Convex requireAuth/requireAdmin checks',
      'Authorization Tests',
    ],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'route-guards',
        label: 'Protected routes are guarded',
        description: 'Protected pages must require authorized access before rendering sensitive content.',
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
        description: 'Server-side actions and data access must enforce role-appropriate authorization.',
        verificationMethod: 'Server function inspection and automated tests',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Server-side access checks rely on requireAuth and requireAdmin before sensitive actions.',
          [
            seededEvidence(
              'Server auth guard enforcement',
              'src/features/auth/server/auth-guards.ts implements requireAuth and requireAdmin for protected server operations.',
            ),
          ],
          'Application Authorization',
        ),
      },
    ],
    seedReview: seededReview(
      'reviewed',
      'Reviewed against shared route guards and server auth guard enforcement.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for defining roles, approving privileged access, and maintaining least-privilege assignments within the service.',
  },
  {
    nist80053Id: 'AU-2',
    internalControlId: 'CTRL-AU-002',
    implementationSummary:
      'This control ensures security-relevant events are identified, recorded, and available for oversight. The platform addresses that objective by capturing audit events for authentication, administrative, and security-significant activity and exposing those records for review and export.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Audit and Logging',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'pass' as const,
    evidenceAssessmentNote:
      'The platform records and exposes security-relevant audit events, and the listed evidence sources directly support that behavior.',
    evidenceSources: ['Audit Logs', 'Auth Audit Plugin', 'Evidence Reports'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'audit-event-capture',
        label: 'Security-relevant events are captured',
        description: 'Authentication, administrative, and security-significant events must be recorded.',
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
        itemId: 'audit-export',
        label: 'Audit records can be reviewed and exported',
        description: 'Authorized reviewers must be able to inspect and export audit evidence.',
        verificationMethod: 'Admin workflow walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The platform exposes audit review and evidence export surfaces for security review.',
          [
            seededEvidence(
              'Organization audit review UI',
              'src/features/organizations/components/OrganizationAuditPage.tsx provides audit history review and export flows.',
            ),
            seededEvidence(
              'Security evidence export workflow',
              'src/routes/app/admin/security.tsx and convex/security.ts provide evidence report generation and export flows.',
            ),
          ],
          'Audit and Logging',
        ),
      },
    ],
    seedReview: seededReview(
      'reviewed',
      'Reviewed against audit event coverage and audit/evidence export surfaces.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for reviewing exported audit records and aligning retention or downstream log handling with their own policies when those records leave the platform.',
  },
  {
    nist80053Id: 'AU-6',
    internalControlId: 'CTRL-AU-006',
    implementationSummary:
      'This control ensures audit records are reviewed, analyzed, and followed up through defined operational workflows. The platform provides evidence queues and audit-integrity signals that support those workflows, but provider-operated review procedures and retained review records are not yet fully evidenced in this register.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Operations',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates evidence queues and integrity checks provided by the platform, but it does not yet include completed provider review records, documented review cadence, or escalation artifacts. Customer procedures are also still required for customer-side review cadence, escalation, and documented follow-up.',
    evidenceSources: ['Evidence Reports', 'Audit Integrity Checks', 'Admin Security Dashboard'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'review-queue-surface',
        label: 'Audit review surfaces exist',
        description: 'The platform must provide a queue or surface for reviewing audit evidence.',
        verificationMethod: 'Admin security UI walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'The security admin surface exposes evidence queues and review-oriented summaries.',
          [
            seededEvidence(
              'Security admin review queue',
              'src/routes/app/admin/security.tsx exposes control workspace and evidence review surfaces.',
            ),
          ],
          'Security Operations',
        ),
      },
      {
        itemId: 'provider-review-procedure',
        label: 'Provider review procedure is documented',
        description: 'Internal review cadence and escalation expectations must be documented for platform operators.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider-side documented review cadence or escalation procedure is attached in the repo-backed control workspace yet.',
          [],
          'Security Operations',
        ),
      },
      {
        itemId: 'provider-review-records',
        label: 'Provider review records are retained',
        description: 'Completed review records or attestations must be retained for audit review activities.',
        verificationMethod: 'Review record inspection',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No retained provider review records or attestations are currently attached.',
          [],
          'Security Operations',
        ),
      },
    ],
    seedReview: seededReview(
      'needs-follow-up',
      'Platform review surfaces exist, but provider review procedure and retained review records still need evidence.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for establishing review cadence, escalation paths, and documented follow-up for the evidence surfaced by the platform.',
  },
  {
    nist80053Id: 'IA-2',
    internalControlId: 'CTRL-IA-002',
    implementationSummary:
      'This control ensures users are uniquely identified and authenticated before accessing protected service functionality. The platform supports that objective through authenticated access flows, verified-email checks, and MFA or passkey capability, but this register does not yet fully evidence provider-enforced production authentication policy.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Authentication',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates platform authentication flows and MFA capabilities, but it does not yet fully demonstrate provider-side enforcement expectations for production authentication policy. Customer evidence is still required for identity proofing, MFA enforcement policy, and account lifecycle governance.',
    evidenceSources: ['Better Auth Users', 'MFA Coverage Summary', 'Passkey Enrollment'],
    evidenceCount: 3,
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
          'Protected application use depends on authenticated access flows.',
          [
            seededEvidence(
              'Shared authenticated route enforcement',
              'src/features/auth/server/auth-guards.ts and route-guards.ts gate authenticated application access.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'verified-email',
        label: 'Verified email checks are enforced',
        description: 'Production authentication flows must enforce verified-email expectations where required.',
        verificationMethod: 'Policy inspection and auth configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Verified email is part of the regulated baseline and surfaced in the security posture summary.',
          [
            seededEvidence(
              'Verified email baseline',
              'convex/security.ts reports emailVerificationRequired from ALWAYS_ON_REGULATED_BASELINE.',
            ),
          ],
          'Authentication',
        ),
      },
      {
        itemId: 'mfa-capability',
        label: 'MFA and passkeys are supported',
        description: 'The platform must support stronger authenticators for eligible accounts.',
        verificationMethod: 'MFA coverage summary review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Passkeys and MFA coverage are exposed in the security posture summary and Better Auth integration.',
          [
            seededEvidence(
              'MFA coverage summary',
              'convex/security.ts calculates MFA and passkey coverage from Better Auth users and passkeys.',
            ),
          ],
          'Authentication',
        ),
      },
    ],
    seedReview: seededReview(
      'reviewed',
      'Reviewed against authenticated route enforcement, verified-email baseline, and MFA/passkey coverage reporting.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for identity proofing, MFA policy decisions, user enrollment expectations, and account lifecycle governance.',
  },
  {
    nist80053Id: 'IA-5',
    internalControlId: 'CTRL-IA-005',
    implementationSummary:
      'This control ensures authenticators are managed, protected, and recoverable in a controlled manner. The platform supports that objective through stronger authenticators, recovery-related auditing, and verification controls around account reset and recovery flows.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Authentication',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates stronger authenticator support and recovery auditing provided by the platform. Customer procedures are still required for credential policy choices and account recovery approvals.',
    evidenceSources: [
      'Passkey Enrollment Records',
      'Password Reset Audit Events',
      'Email Verification Policy',
    ],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'strong-authenticators',
        label: 'Strong authenticators are available',
        description: 'The platform must support strong authenticators such as passkeys or MFA factors.',
        verificationMethod: 'Authenticator capability review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Passkey support is integrated and exposed through profile management and Better Auth plugins.',
          [
            seededEvidence(
              'Passkey support',
              'convex/betterAuth/sharedOptions.ts enables passkey support and profile UI exposes add/delete passkey flows.',
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
          'Recovery-related audit events are defined for reset requests and completion events.',
          [
            seededEvidence(
              'Password reset audit events',
              'src/lib/shared/auth-audit.ts includes password_reset_requested and password_reset_completed event types.',
            ),
          ],
          'Authentication',
        ),
      },
    ],
    seedReview: seededReview(
      'reviewed',
      'Reviewed against passkey capability and reset audit event coverage.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for defining allowed credential types, approving recovery workflows, and governing exceptions to standard authentication policy.',
  },
  {
    nist80053Id: 'CP-9',
    internalControlId: 'CTRL-CP-009',
    implementationSummary:
      'This control ensures service data and required system information are backed up, protected, and recoverable after disruption or loss. For the hosted service, that means provider-operated backup and restore capability for the production environment; this workspace currently evidences backup-verification recordkeeping, but provider-operated backup configuration and restore-test evidence are not yet fully attached here.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure Operations',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register currently substantiates the platform workflow for recording backup-verification outcomes. Additional provider evidence is still required to demonstrate backup configuration, retention, and restore testing for the hosted service.',
    evidenceSources: ['Backup Verification Reports'],
    evidenceCount: 1,
    hipaaCitations: ['45 CFR 164.308(a)(7)(ii)(A)', '45 CFR 164.308(a)(7)(ii)(B)'],
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
          'not_started',
          'The control register does not yet include provider backup configuration evidence for the hosted production environment.',
          [],
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
          'The platform includes a backup verification report table and internal mutation for recording backup verification outcomes.',
          [
            seededEvidence(
              'Backup verification storage',
              'convex/schema.ts defines backupVerificationReports and convex/security.ts exposes recordBackupVerification.',
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
          'not_started',
          'The control workspace does not yet contain restore test results or recovery exercise records for the hosted production environment.',
          [],
          'Infrastructure Operations',
        ),
      },
    ],
    seedReview: seededReview(
      'needs-follow-up',
      'Provider-operated backup and restore evidence is still needed before this hosted SaaS control can be presented as fully substantiated.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for determining whether the hosted service backup and recovery posture satisfies their retention, recovery-time, and business continuity requirements, and for protecting any data they export or replicate outside the service.',
  },
  {
    nist80053Id: 'IR-4',
    internalControlId: 'CTRL-IR-004',
    implementationSummary:
      'This control ensures security incidents can be handled through defined response, investigation, and follow-up procedures. The platform supports that objective by providing audit trails and evidence outputs that can assist incident investigation and post-incident analysis, while substantive incident response procedures remain customer-operated in this model.',
    coverage: 'not-covered' as const,
    responsibility: 'customer' as const,
    priority: 'p0' as const,
    owner: 'Security Incident Response',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceAssessmentNote:
      'This register substantiates supporting platform evidence, but it does not include completed incident response exercises, response records, or runbook reviews for customer-side procedures.',
    evidenceSources: ['Incident Runbooks', 'Audit Event Export', 'Evidence Reports'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'incident-evidence-export',
        label: 'Incident-supporting evidence can be exported',
        description: 'The platform should expose audit trails and evidence exports that support investigations.',
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
    ],
    seedReview: seededReview(
      'needs-follow-up',
      'Platform evidence export support exists, but customer-side incident procedures remain outside platform scope.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for incident response procedures, internal escalation contacts, and customer-side post-incident handling.',
  },
  {
    nist80053Id: 'RA-5',
    internalControlId: 'CTRL-RA-005',
    implementationSummary:
      'This control ensures vulnerabilities affecting the hosted service are identified, assessed, remediated, or formally risk-accepted. The platform security program addresses that objective through vulnerability discovery, triage, remediation tracking, and risk treatment for the hosted service environment.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Security Engineering',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register identifies expected vulnerability-management evidence for the hosted service, but current attachments do not yet fully demonstrate scanning cadence and remediation closure.',
    evidenceSources: ['Scanner Integrations', 'Dependency Audit Results', 'Risk Review Notes'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)', '45 CFR 164.308(a)(1)(ii)(B)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'scanner-program',
        label: 'Vulnerability scanning is performed',
        description: 'The hosted service security program must perform vulnerability discovery activities.',
        verificationMethod: 'Scanner evidence review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The platform has malware/document scanning telemetry, but that is not full hosted-service vulnerability management evidence.',
          [
            seededEvidence(
              'Document scanning telemetry',
              'convex/security.ts reports documentScanEvents summary for file inspection, which is related security telemetry but not full vulnerability management coverage.',
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
    ],
    seedReview: seededReview(
      'needs-follow-up',
      'Related security telemetry exists, but repo-backed evidence is not sufficient to mark full vulnerability-management coverage complete.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for addressing vulnerabilities in their own endpoints, identity stores, integrations, and operational environments connected to the service.',
  },
  {
    nist80053Id: 'SC-8',
    internalControlId: 'CTRL-SC-008',
    implementationSummary:
      'This control ensures information transmitted by the service is protected against unauthorized disclosure or modification in transit. The platform addresses that objective by providing secure transport for hosted traffic and enforcing transport-sensitive application behavior.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure and Platform Security',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates platform transport-sensitive settings and secure-session behavior. Additional infrastructure evidence may still be required to verify certificate lifecycle management and edge enforcement operated for the hosted service.',
    evidenceSources: [
      'HTTPS deployment policy',
      'Secure Link TTL Settings',
      'Session Transport Configuration',
    ],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.312(e)(1)', '45 CFR 164.312(e)(2)(i)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'tls-enabled',
        label: 'TLS is enabled for hosted endpoints',
        description: 'Production traffic to hosted endpoints must use secure transport.',
        verificationMethod: 'HTTPS endpoint verification',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The hosted app is designed for HTTPS operation, but no explicit repo-backed production certificate artifact is attached here.',
          [
            seededEvidence(
              'Secure transport implementation summary',
              'convex/security.ts surfaces secure-session posture, but production TLS termination proof is still infrastructure-specific.',
              { sufficiency: 'partial' },
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'session-transport',
        label: 'Secure session transport settings are enforced',
        description: 'Session and temporary-link transport settings must align with secure transport expectations.',
        verificationMethod: 'Session configuration review',
        required: true,
        suggestedEvidenceTypes: ['system', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Short-lived verification windows and temporary-link TTLs are surfaced in the security posture summary.',
          [
            seededEvidence(
              'Session transport configuration',
              'convex/security.ts reports sessionExpiryHours, recentStepUpWindowMinutes, and temporaryLinkTtlMinutes.',
            ),
          ],
          'Infrastructure and Platform Security',
        ),
      },
      {
        itemId: 'certificate-operations',
        label: 'Certificate and edge operations are documented',
        description: 'The hosted platform must retain evidence for certificate lifecycle management and edge enforcement.',
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
    seedReview: seededReview(
      'needs-follow-up',
      'Application-side secure-session settings are evidenced, but hosted certificate and edge-operation proof still needs attachment.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for requiring secure access to the service within their own networks, browsers, devices, and downstream integrations.',
  },
  {
    nist80053Id: 'SC-28',
    internalControlId: 'CTRL-SC-028',
    implementationSummary:
      'This control ensures information stored within the service boundary is protected against unauthorized access or alteration at rest. The platform addresses that objective through hosted storage protections, data-handling controls, and retention behavior for data managed within the service boundary.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Data Protection',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates platform data-handling and retention behaviors. Additional hosted infrastructure evidence may still be required for encryption-at-rest configuration and key-management verification.',
    evidenceSources: ['Storage Configuration', 'Retention Jobs', 'Vendor Boundary Policy'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.312(a)(2)(iv)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'storage-protection',
        label: 'Hosted storage protections are configured',
        description: 'Data at rest protections must be configured for hosted storage within the service boundary.',
        verificationMethod: 'Storage configuration review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'Hosted storage protections are part of the design, but repo-backed proof for encryption-at-rest and key management is not attached yet.',
          [
            seededEvidence(
              'Hosted storage lifecycle tracking',
              'convex/storagePlatform.ts and convex/schema.ts show managed storage lifecycle handling inside the service boundary.',
              { sufficiency: 'partial' },
            ),
          ],
          'Data Protection',
        ),
      },
      {
        itemId: 'retention-controls',
        label: 'Retention behavior is implemented',
        description: 'Retention jobs or controls must enforce data handling expectations.',
        verificationMethod: 'Retention job review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Retention jobs are tracked and surfaced in the security posture summary.',
          [
            seededEvidence(
              'Retention job tracking',
              'convex/security.ts reports retention job status and convex/schema.ts defines retentionJobs.',
            ),
          ],
          'Data Protection',
        ),
      },
    ],
    seedReview: seededReview(
      'needs-follow-up',
      'Retention behavior is evidenced, but hosted encryption-at-rest and key-management proof still needs to be attached.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for governing exported data, retention obligations they impose on platform use, and any external storage or integrations they control.',
  },
  {
    nist80053Id: 'SI-4',
    internalControlId: 'CTRL-SI-004',
    implementationSummary:
      'This control ensures the service is monitored for indicators of attack, misuse, or operationally significant security events. The platform emits monitoring-relevant signals such as scan events, audit-integrity checks, and telemetry posture summaries, but provider-operated alert response procedures and retained follow-up records are not yet fully evidenced in this register.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'This register substantiates monitoring-related signals emitted by the platform, but it does not yet include complete provider evidence for alert routing, review cadence, or response follow-up. Customer procedures are still required for alert review, internal escalation, and coordination with the provider when customer action is needed.',
    evidenceSources: ['Document Scan Events', 'Audit Integrity Checks', 'Telemetry Posture Summary'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'monitoring-signals',
        label: 'Monitoring signals are emitted',
        description: 'The platform must emit monitoring-relevant security signals for operational review.',
        verificationMethod: 'Telemetry and event review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Monitoring-related platform signals are exposed through document scan events, audit integrity checks, and telemetry posture summaries.',
          [
            seededEvidence(
              'Security monitoring signals',
              'convex/security.ts reports document scan events, audit integrity failures, and telemetry posture.',
            ),
          ],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'provider-alert-procedure',
        label: 'Provider alert response procedure is documented',
        description: 'Internal alert routing and response expectations must be documented for the hosted platform.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider-operated monitoring response procedure is attached in the control workspace yet.',
          [],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'provider-alert-records',
        label: 'Provider alert review records are available',
        description: 'The platform team must retain evidence of alert review or follow-up activities.',
        verificationMethod: 'Operational record review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No provider alert review or follow-up records are currently attached.',
          [],
          'Security Monitoring',
        ),
      },
    ],
    seedReview: seededReview(
      'needs-follow-up',
      'Monitoring signals are present, but provider alert-routing procedure and review records still need evidence.',
    ),
    customerResponsibilityNotes:
      'Customer organizations are responsible for reviewing service notifications, acting on customer-visible alerts, and integrating platform outputs into their own operational response processes.',
  },
] satisfies ReadonlyArray<{
  evidenceCount: number;
  evidenceAssessmentNote: string;
  evidenceSources: string[];
  hipaaCitations: string[];
  coverage: Coverage;
  implementationSummary: string;
  internalControlId: string;
  latestEvidenceStatus: EvidenceStatus;
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
  seedReview: {
    notes: string | null;
    status: ReviewStatus;
  };
  reviewStatus: ReviewStatus;
  customerResponsibilityNotes: string;
}>;

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

  const controls = ACTIVE_CONTROL_BLUEPRINTS.map((blueprint) => {
    const sourceControl = nistControlMap.get(blueprint.nist80053Id);

    if (!sourceControl) {
      throw new Error(`Missing NIST 800-53 moderate control: ${blueprint.nist80053Id}`);
    }

    return {
      internalControlId: blueprint.internalControlId,
      nist80053Id: sourceControl.nist80053Id,
      title: sourceControl.title,
      familyId: sourceControl.familyId,
      familyTitle: sourceControl.familyTitle,
      coverage: blueprint.coverage,
      implementationSummary: blueprint.implementationSummary,
      controlStatement:
        flattenStatement(sourceControl.statement) ??
        `${sourceControl.title} is tracked as an active control in the platform register.`,
      priority: blueprint.priority,
      platformChecklistItems: blueprint.platformChecklistItems,
      owner: blueprint.owner,
      responsibility: blueprint.responsibility,
      seedReview: blueprint.seedReview,
      reviewStatus: blueprint.reviewStatus,
      lastReviewedAt: null,
      customerResponsibilityNotes: blueprint.customerResponsibilityNotes,
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
        csf20: (csfIndex[sourceControl.nist80053Id] ?? []).map((entry) => ({
          subcategoryId: entry.subcategoryId,
          label: `${entry.functionId} / ${entry.categoryId}: ${entry.subcategoryTitle}`,
        })),
        soc2: (soc2Index[sourceControl.nist80053Id] ?? []).map((entry) => ({
          criterionId: entry.criterionId,
          group: entry.group,
          label: entry.title,
          trustServiceCategory: entry.trustServiceCategory,
        })),
      },
      evidence: {
        assessmentNote: blueprint.evidenceAssessmentNote,
        latestEvidenceStatus: blueprint.latestEvidenceStatus,
        evidenceCount: blueprint.evidenceCount,
        evidenceSources: blueprint.evidenceSources,
      },
    };
  }).sort((left, right) => {
    const priorityCompare = left.priority.localeCompare(right.priority);
    if (priorityCompare !== 0) {
      return priorityCompare;
    }

    const coverageCompare = coverageSortValue(left.coverage) - coverageSortValue(right.coverage);
    if (coverageCompare !== 0) {
      return coverageCompare;
    }

    return left.nist80053Id.localeCompare(right.nist80053Id);
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
