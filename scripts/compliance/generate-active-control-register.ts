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

const ACTIVE_CONTROL_BLUEPRINTS: ReadonlyArray<{
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
  customerResponsibilityNotes: string;
}> = [
  {
    nist80053Id: 'AC-2',
    internalControlId: 'CTRL-AC-002',
    implementationSummary:
      'This control ensures accounts are authorized, provisioned, changed, and removed through controlled lifecycle workflows. The platform supports that objective through organization policy controls, SCIM-backed provisioning paths, role-based boundaries, and auditable membership lifecycle events in the hosted service.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Identity and Access Management',
    hipaaCitations: ['45 CFR 164.308(a)(3)', '45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'rbac-boundaries',
        label: 'Role boundaries are enforced',
        description:
          'Account roles and tenant boundaries must prevent unauthorized cross-account access.',
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
      'This control ensures users and processes can perform only the actions and data access they are authorized to use. The platform addresses that objective through route-level guards, server-side authorization checks, and organization-scoped permission decisions for protected application flows and sensitive operations.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Application Authorization',
    hipaaCitations: ['45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
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
      'This control ensures security-relevant events are identified, recorded, protected, and made available for oversight. The platform addresses that objective by capturing audit events for authentication, administrative, and security-significant activity, integrity-linking those records, and exposing them for review and export.',
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
      {
        itemId: 'audit-integrity',
        label: 'Audit record integrity is checked',
        description:
          'Audit records should retain integrity metadata or verification signals that help detect tampering.',
        verificationMethod: 'Audit integrity implementation review',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Audit records are hash-linked and the platform can detect and log integrity failures.',
          [
            seededEvidence(
              'Hash-linked audit log chain',
              'convex/audit.ts stores eventHash and previousEventHash for audit events and verifies the chain during integrity checks.',
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
      'This control ensures audit records are reviewed, analyzed, and followed up through defined operational workflows. The platform provides review queues, stored review states, and integrity-linked evidence exports that support those workflows, while operator review cadence and escalation procedure remain deployment-owned.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Operations',
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
        itemId: 'review-record-retention',
        label: 'Review records can be retained',
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
        label: 'Operator review procedure is documented',
        description:
          'Internal review cadence and escalation expectations must be documented for platform operators.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No operator-owned documented review cadence or escalation procedure is attached in the repo-backed control workspace yet.',
          [],
          'Security Operations',
        ),
      },
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for establishing review cadence, escalation paths, and documented follow-up for the evidence surfaced by the platform.',
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
          'Protected application use depends on authenticated access flows.',
          [
            seededEvidence(
              'Shared authenticated route enforcement',
              'src/features/auth/server/auth-guards.ts and route-guards.ts gate authenticated and admin application access.',
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
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
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
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for defining allowed credential types, approving recovery workflows, and governing exceptions to standard authentication policy.',
  },
  {
    nist80053Id: 'CP-9',
    internalControlId: 'CTRL-CP-009',
    implementationSummary:
      'This control ensures service data and required system information are backed up, protected, and recoverable after disruption or loss. For the hosted service, that means operator-run backup and restore capability for the production environment; this workspace currently evidences backup-verification recordkeeping, but operator backup configuration and restore-test evidence are not yet fully attached here.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure Operations',
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
    customerResponsibilityNotes:
      'Customer organizations are responsible for determining whether the hosted service backup and recovery posture satisfies their retention, recovery-time, and business continuity requirements, and for protecting any data they export or replicate outside the service.',
  },
  {
    nist80053Id: 'IR-4',
    internalControlId: 'CTRL-IR-004',
    implementationSummary:
      'This control ensures security incidents can be handled through defined response, investigation, and follow-up procedures. The platform supports that objective by providing audit trails, exportable evidence, and retained investigation artifacts that can assist incident investigation and post-incident analysis, while substantive incident response procedures remain customer-operated in this model.',
    coverage: 'not-covered' as const,
    responsibility: 'customer' as const,
    priority: 'p0' as const,
    owner: 'Security Incident Response',
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'incident-evidence-export',
        label: 'Incident-supporting evidence can be exported',
        description:
          'The platform should expose audit trails and evidence exports that support investigations.',
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
        label: 'Investigation-supporting artifacts can be retained',
        description:
          'The platform should retain hashes, review state, and exported evidence metadata that support post-incident analysis.',
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
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for incident response procedures, internal escalation contacts, and customer-side post-incident handling.',
  },
  {
    nist80053Id: 'RA-5',
    internalControlId: 'CTRL-RA-005',
    implementationSummary:
      'This control ensures vulnerabilities or security-relevant findings affecting the hosted service are identified, assessed, remediated, or formally risk-accepted. The app ships automated inspection and malware-finding hooks for file-ingest surfaces, but hosted-service vulnerability scanning cadence and remediation tracking still require operator processes.',
    coverage: 'partial' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Security Engineering',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)', '45 CFR 164.308(a)(1)(ii)(B)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'scanner-program',
        label: 'Automated security scanning hooks exist',
        description:
          'The platform should implement automated inspection or malware-finding hooks for security-relevant ingest paths.',
        verificationMethod: 'Scanner implementation review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'in_progress',
          'The platform has built-in file inspection and GuardDuty webhook integration for file-ingest surfaces, but that is not full hosted-service vulnerability-management evidence.',
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
    customerResponsibilityNotes:
      'Customer organizations are responsible for addressing vulnerabilities in their own endpoints, identity stores, integrations, and operational environments connected to the service.',
  },
  {
    nist80053Id: 'SC-8',
    internalControlId: 'CTRL-SC-008',
    implementationSummary:
      'This control ensures information transmitted by the service is protected against unauthorized disclosure or modification in transit. The platform addresses that objective by enforcing HTTPS-oriented auth configuration, trusted-origin checks, secure cookie behavior, and SSL-only storage transport for managed file paths.',
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
          'Short-lived verification windows and temporary-link TTLs are surfaced in the security posture summary.',
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
    nist80053Id: 'SC-28',
    internalControlId: 'CTRL-SC-028',
    implementationSummary:
      'This control ensures information stored within the service boundary is protected against unauthorized access or alteration at rest. The platform addresses that objective through managed encrypted storage, blocked public access, controlled file serving, and retention behavior for data managed within the service boundary.',
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
          'Managed storage configuration enforces blocked public access, server-side encryption, versioning, and signed file-serving paths.',
          [
            seededEvidence(
              'Encrypted S3 storage configuration',
              'infra/aws-cdk/lib/malware-scan-stack.cts provisions an S3 bucket with BLOCK_ALL public access, S3-managed encryption, enforceSSL, object ownership enforcement, and versioning.',
            ),
            seededEvidence(
              'Controlled file-serving paths',
              'convex/storagePlatform.ts resolves signed file URLs and routes non-Convex storage access through signed serve paths.',
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
    customerResponsibilityNotes:
      'Customer organizations are responsible for governing exported data, retention obligations they impose on platform use, and any external storage or integrations they control.',
  },
  {
    nist80053Id: 'SI-4',
    internalControlId: 'CTRL-SI-004',
    implementationSummary:
      'This control ensures the service is monitored for indicators of attack, misuse, or operationally significant security events. The platform emits monitoring-relevant signals such as scan events, audit-integrity checks, malware findings, and telemetry posture summaries, but operator alert response procedures are not yet fully evidenced in this register.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'monitoring-signals',
        label: 'Monitoring signals are emitted',
        description:
          'The platform must emit monitoring-relevant security signals for operational review.',
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
        label: 'Operator alert response procedure is documented',
        description:
          'Internal alert routing and response expectations must be documented for the hosted platform.',
        verificationMethod: 'Procedure review',
        required: true,
        suggestedEvidenceTypes: ['file', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'not_started',
          'No operator-owned monitoring response procedure is attached in the control workspace yet.',
          [],
          'Security Monitoring',
        ),
      },
      {
        itemId: 'monitoring-records-retained',
        label: 'Monitoring records are retained',
        description:
          'The platform should retain monitoring outputs that investigators or operators can review after signals are generated.',
        verificationMethod: 'Monitoring record review',
        required: true,
        suggestedEvidenceTypes: ['file', 'link', 'note'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Monitoring-related records are retained through document scan events, audit-integrity failures, and evidence report metadata.',
          [
            seededEvidence(
              'Document scan event records',
              'convex/schema.ts defines documentScanEvents and convex/security.ts reports their latest status, rejection counts, and quarantine counts.',
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

      return {
        internalControlId: blueprint.internalControlId,
        nist80053Id: sourceControl.nist80053Id,
        title: sourceControl.title,
        familyId: sourceControl.familyId,
        familyTitle: sourceControl.familyTitle,
        implementationSummary: blueprint.implementationSummary,
        controlStatement:
          flattenStatement(sourceControl.statement) ??
          `${sourceControl.title} is tracked as an active control in the platform register.`,
        priority: blueprint.priority,
        platformChecklistItems: blueprint.platformChecklistItems,
        owner: blueprint.owner,
        responsibility: blueprint.responsibility,
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
