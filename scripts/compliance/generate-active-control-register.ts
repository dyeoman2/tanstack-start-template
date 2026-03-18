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
        description: 'Authorized reviewers must be able to inspect captured audit activity through supported review surfaces.',
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
      'This control ensures audit records and related security findings can be reviewed, analyzed, and followed up through defined workflows. The platform provides audit history views, review-state retention, and evidence-report workflows that support that process, while formal operator review cadence and escalation procedures remain deployment-owned.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Operations',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['DE.AE-02', 'DE.AE-03'],
    soc2CriterionIds: ['CC7.2', 'CC7.3'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'review-queue-surface',
        label: 'Audit review surfaces exist',
        description: 'The platform must provide supported surfaces for reviewing audit activity and related security evidence.',
        verificationMethod: 'Audit review UI walkthrough',
        required: true,
        suggestedEvidenceTypes: ['system', 'file'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Authorized users can review organization audit history and security-admin evidence state through built-in surfaces.',
          [
            seededEvidence(
              'Organization audit review surface',
              'src/features/organizations/components/OrganizationAuditPage.tsx exposes reviewable audit history for organization roles.',
            ),
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
          'in_progress',
          'The platform includes a dedicated backup verification record path, but this workspace does not yet contain retained hosted-environment verification entries.',
          [
            seededEvidence(
              'Backup verification record path',
              'convex/schema.ts defines backupVerificationReports and convex/security.ts exposes recordBackupVerification for storing backup and restore verification outcomes.',
              { sufficiency: 'partial' },
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
          'in_progress',
          'The platform has a restore-verification record shape and audit events, but hosted-environment restore drill results are not attached in this workspace yet.',
          [
            seededEvidence(
              'Restore verification data model',
              'convex/schema.ts stores restore_verification drill records and convex/security.ts records backup_restore_drill_completed and backup_restore_drill_failed audit events.',
              { sufficiency: 'partial' },
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
    nist80053Id: 'IR-4',
    internalControlId: 'CTRL-IR-004',
    implementationSummary:
      'This control addresses incident handling expectations. In this workspace the platform only evidences investigation-supporting audit trails, exportable evidence, and retained review artifacts; substantive incident response procedures remain outside the hosted product evidence and are customer or provider program responsibilities.',
    coverage: 'not-covered' as const,
    responsibility: 'customer' as const,
    priority: 'p0' as const,
    owner: 'Security Incident Response',
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    csf20Ids: ['RS.AN-03', 'RS.CO-02'],
    soc2CriterionIds: [],
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
      'Customer organizations are responsible for incident detection, triage, escalation, containment, notification, and post-incident handling; the platform evidence here is only investigation-supporting material.',
  },
  {
    nist80053Id: 'RA-5',
    internalControlId: 'CTRL-RA-005',
    implementationSummary:
      'This control addresses vulnerability and security finding identification. The app ships automated inspection and malware-finding hooks for file-ingest surfaces, but hosted-service vulnerability scanning cadence, remediation tracking, and formal risk treatment still require operator processes outside this repo-backed workspace.',
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
        description: 'Access to stored protected files should rely on controlled serve paths rather than open object access.',
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
      'This control ensures the service is monitored for indicators of attack, misuse, or operationally significant security events. The platform emits monitoring-relevant signals such as scan events, audit-integrity checks, and security posture summaries, but operator alert response procedures are not yet fully evidenced in this register.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(c)(1)'],
    csf20Ids: ['DE.CM-01', 'DE.CM-06', 'DE.AE-02', 'DE.AE-03'],
    soc2CriterionIds: ['CC7.2'],
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
          'Monitoring-related platform signals are exposed through document scan events, audit integrity checks, and security posture summaries.',
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
    ],
    customerResponsibilityNotes:
      'Customer organizations are responsible for granting roles appropriately, reviewing privileged assignments, and limiting who receives elevated access within their tenant.',
  },
  {
    nist80053Id: 'AU-9',
    internalControlId: 'CTRL-AU-009',
    implementationSummary:
      'This control ensures audit information is protected from unauthorized modification, monitored for tampering, and preserved with integrity metadata when shared or exported. The platform supports those objectives through access-controlled audit views, hash-linked audit records, and integrity-linked evidence report exports, while immutable retention controls beyond the application layer are not yet fully evidenced here.',
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
          'Evidence reports retain content hashes, export hashes, integrity summaries, and review metadata for later verification.',
          [
            seededEvidence(
              'Evidence report integrity fields',
              'convex/schema.ts defines contentHash, exportHash, exportIntegritySummary, reviewStatus, reviewedAt, and reviewedByUserId on evidenceReports.',
            ),
            seededEvidence(
              'Integrity-linked export workflow',
              'convex/security.ts generates export bundles with content and export hashes, and src/routes/app/admin/security.tsx surfaces those values to reviewers.',
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
      'This control ensures the platform generates audit records for defined security-relevant events across application and backend workflows. The platform supports that objective through a canonical event inventory and event emission across authentication, administrative, evidence, and file-handling paths.',
    coverage: 'covered' as const,
    responsibility: 'platform' as const,
    priority: 'p0' as const,
    owner: 'Audit and Logging',
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)'],
    csf20Ids: ['PR.PS-04', 'DE.CM-01', 'DE.CM-03'],
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
          'Core security-sensitive workflows should emit audit records during normal and failed operations.',
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
      'This control ensures externally provided services are governed by defined boundary expectations, permitted data classes, and auditable usage. The platform supports that objective through a vendor boundary registry, explicit allowed-data-class policies, approval gates, and audit events for vendor use or denial, while buyer-facing contractual and subprocessor program artifacts remain outside this repo-backed register.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Vendor Risk Management',
    hipaaCitations: ['45 CFR 164.308(b)(1)', '45 CFR 164.308(a)(1)(ii)(A)'],
    csf20Ids: ['GV.SC-05', 'GV.SC-06', 'ID.AM-02'],
    soc2CriterionIds: ['CC9.2'],
    nist80066: [],
    platformChecklistItems: [
      {
        itemId: 'vendor-inventory-and-data-classes',
        label: 'External services and subprocessors are inventoried with approved data classes',
        description:
          'Approved external services should be recorded with the categories of data the service is permitted to handle, even if broader legal subprocessor records live elsewhere.',
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
        label: 'Vendor usage is auditable and blocked when approval requirements are not met',
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
    ],
    customerResponsibilityNotes:
      'Customer organizations remain responsible for their own vendor due diligence, contract review, and deciding whether the platform vendor set satisfies their subprocessor and business-associate requirements.',
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
          'The auth runtime rejects malformed origins and enforces secure session configuration for regulated deployments.',
          [
            seededEvidence(
              'Fail-closed Better Auth env validation',
              'src/lib/server/env.server.ts rejects invalid BETTER_AUTH_URL, preview host, and trusted-origin configuration at startup.',
            ),
            seededEvidence(
              'Explicit secure session settings',
              'convex/betterAuth/sharedOptions.ts sets session expiry, refresh, freshness, database-backed sessions, and disables cookie cache for security-sensitive revocation behavior.',
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
    nist80053Id: 'SI-7',
    internalControlId: 'CTRL-SI-007',
    implementationSummary:
      'This control ensures important service data and content flows retain integrity signals that help detect mismatches, tampering, or unsafe alteration. The platform supports that objective through file signature validation, hash-linked audit records, and integrity-linked evidence and signed file-serving flows.',
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
          'Evidence exports preserve content and export hashes, and signed file-serving paths protect storage access flows.',
          [
            seededEvidence(
              'Evidence export integrity metadata',
              'convex/security.ts computes contentHash and exportHash values and stores exportIntegritySummary for evidence report exports.',
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
    nist80053Id: 'CA-7',
    internalControlId: 'CTRL-CA-007',
    implementationSummary:
      'This control ensures security-relevant posture signals are collected, summarized, and made available for recurring internal review. The platform supports that objective through a posture summary query, retained scan and retention records, audit-integrity telemetry, and evidence report generation from current monitoring state.',
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
          'Monitoring outputs include audit integrity failures, document scan records, retention jobs, and backup verification records.',
          [
            seededEvidence(
              'Monitoring evidence tables',
              'convex/schema.ts defines documentScanEvents, retentionJobs, and backupVerificationReports used by posture and review workflows.',
            ),
            seededEvidence(
              'Audit integrity monitoring signal',
              'convex/security.ts counts audit_integrity_check_failed events and includes the result in the posture summary.',
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
      'This control ensures security-relevant changes are made through controlled, reviewable, and reproducible mechanisms. The platform supports that objective through automated guardrail checks on Convex functions and reproducible compliance generation workflows, while formal approval records and operator change-management procedures are not yet fully evidenced in the repo-backed register.',
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
          'in_progress',
          'The repo shows reproducible generation and validation workflows, but formal approval or change-review records are not attached in the control workspace yet.',
          [
            seededEvidence(
              'Reproducible compliance refresh workflow',
              'package.json defines compliance:refresh to regenerate the compliance artifacts from source rather than hand-editing outputs.',
              { sufficiency: 'partial' },
            ),
          ],
          'Change Management',
        ),
      },
      {
        itemId: 'automated-guardrail-checks',
        label: 'Automated checks validate auth guardrails, function safety, and typed contracts',
        description:
          'Automated checks should validate authorization guardrails and type-level expectations for protected backend functions.',
        verificationMethod: 'Automated code-health audit review',
        required: true,
        suggestedEvidenceTypes: ['file', 'system'] as ChecklistEvidenceType[],
        seed: seededChecklist(
          'done',
          'Automated checks scan exported Convex functions for approved auth wrappers and required return validators.',
          [
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
