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
type Responsibility = 'operator-owned' | 'platform' | 'shared-responsibility' | null;

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

const ACTIVE_CONTROL_BLUEPRINTS = [
  {
    nist80053Id: 'AC-2',
    internalControlId: 'CTRL-AC-002',
    implementationSummary:
      'The platform supports role-based account boundaries, admin-managed access changes, and audit visibility into membership changes. Workforce onboarding, offboarding, and periodic access review remain external operating responsibilities.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Identity and Access Management',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'Supporting evidence exists for platform account boundaries and audit visibility, but workforce onboarding, offboarding, and periodic access review remain external operating responsibilities and are not evidenced in this register.',
    evidenceSources: ['Auth Users', 'Organization Membership Changes', 'Admin Audit Events'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(3)', '45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The platform enforces account boundaries and admin workflows, but workforce onboarding, termination, and periodic access review remain external operating responsibilities.',
  },
  {
    nist80053Id: 'AC-3',
    internalControlId: 'CTRL-AC-003',
    implementationSummary:
      'The platform enforces route- and server-side authorization checks for protected application actions and data access.',
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
    sharedResponsibilityNotes:
      'Platform guards and server-side authorization are built in. Role assignment and least-privilege policy decisions still need to be maintained by the operating organization.',
  },
  {
    nist80053Id: 'AU-2',
    internalControlId: 'CTRL-AU-002',
    implementationSummary:
      'The platform records security-relevant audit events and exposes them for review and export.',
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
    sharedResponsibilityNotes:
      'The platform records security-relevant events, but retention, alerting, and external log shipping remain deployment-specific operating decisions.',
  },
  {
    nist80053Id: 'AU-6',
    internalControlId: 'CTRL-AU-006',
    implementationSummary:
      'The platform provides evidence queues and audit integrity signals, but human review cadence and follow-up procedures remain external operating responsibilities.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Operations',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'Evidence queues and integrity checks exist, but the actual review cadence, escalation, and documented follow-up process are not yet demonstrated.',
    evidenceSources: ['Evidence Reports', 'Audit Integrity Checks', 'Admin Security Dashboard'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The platform exposes evidence and review queues, but review cadence, escalation, and documented follow-up remain external operating responsibilities.',
  },
  {
    nist80053Id: 'IA-2',
    internalControlId: 'CTRL-IA-002',
    implementationSummary:
      'The platform includes authenticated access flows, verified-email checks, and MFA/passkey support for user accounts.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Authentication',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'Authentication and MFA-related evidence exists, but production identity proofing, MFA enforcement policy, and account lifecycle decisions remain external operating responsibilities.',
    evidenceSources: ['Better Auth Users', 'MFA Coverage Summary', 'Passkey Enrollment'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'Authentication scaffolding is built in, but production identity proofing, MFA policy, and account lifecycle decisions remain external operating responsibilities.',
  },
  {
    nist80053Id: 'IA-5',
    internalControlId: 'CTRL-IA-005',
    implementationSummary:
      'The platform supports stronger authenticators, reset auditing, and verification controls around account recovery flows.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Authentication',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'The platform supports stronger authenticators and recovery auditing, but credential policy choices and account recovery procedures are not fully evidenced here.',
    evidenceSources: [
      'Passkey Enrollment Records',
      'Password Reset Audit Events',
      'Email Verification Policy',
    ],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The platform supports stronger authenticators and reset auditing, but allowed credential types and recovery workflows remain external operating decisions.',
  },
  {
    nist80053Id: 'CP-9',
    internalControlId: 'CTRL-CP-009',
    implementationSummary:
      'The platform can record backup verification results, but the backup process, restore testing, and recovery operations are external infrastructure and operating responsibilities.',
    coverage: 'not-covered' as const,
    responsibility: 'operator-owned' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure Operations',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceAssessmentNote:
      'Backup verification is expected to come from deployment infrastructure, and no completed backup or restore evidence is attached in this register.',
    evidenceSources: ['Backup Verification Reports'],
    evidenceCount: 1,
    hipaaCitations: ['45 CFR 164.308(a)(7)(ii)(A)', '45 CFR 164.308(a)(7)(ii)(B)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The platform can record backup verification outcomes, but backup strategy and restore testing remain external infrastructure and operating responsibilities.',
  },
  {
    nist80053Id: 'IR-4',
    internalControlId: 'CTRL-IR-004',
    implementationSummary:
      'The platform provides audit trails and evidence outputs that can support incident response, but response execution remains an operational responsibility.',
    coverage: 'not-covered' as const,
    responsibility: 'operator-owned' as const,
    priority: 'p0' as const,
    owner: 'Security Incident Response',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceAssessmentNote:
      'The control points to supporting incident materials, but no completed incident response evidence or exercised runbook review is recorded here.',
    evidenceSources: ['Incident Runbooks', 'Audit Event Export', 'Evidence Reports'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The product emits evidence and audit trails, but incident response procedures, contacts, and post-incident handling remain external operating responsibilities.',
  },
  {
    nist80053Id: 'RA-5',
    internalControlId: 'CTRL-RA-005',
    implementationSummary:
      'The platform can surface security-related signals, but vulnerability scanning, triage, remediation, and risk acceptance are external security operations responsibilities.',
    coverage: 'not-covered' as const,
    responsibility: 'operator-owned' as const,
    priority: 'p0' as const,
    owner: 'Security Engineering',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceAssessmentNote:
      'The expected vulnerability scanning and remediation evidence has not been attached, so this control remains unsupported in the current register.',
    evidenceSources: ['Scanner Integrations', 'Dependency Audit Results', 'Risk Review Notes'],
    evidenceCount: 0,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)', '45 CFR 164.308(a)(1)(ii)(B)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'Vulnerability management is outside the platform boundary. Scanning, triage, remediation, and documented risk treatment remain external security operations responsibilities.',
  },
  {
    nist80053Id: 'SC-8',
    internalControlId: 'CTRL-SC-008',
    implementationSummary:
      'The platform relies on secure transport configuration and exposes transport-sensitive settings, while TLS termination and edge network configuration remain external infrastructure responsibilities.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure and Platform Security',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'Transport-related settings are identified, but TLS termination, certificate management, and edge enforcement remain external infrastructure responsibilities.',
    evidenceSources: [
      'HTTPS deployment policy',
      'Secure Link TTL Settings',
      'Session Transport Configuration',
    ],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.312(e)(1)', '45 CFR 164.312(e)(2)(i)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The platform relies on secure transport, but TLS termination, certificate management, and network edge configuration remain external infrastructure responsibilities.',
  },
  {
    nist80053Id: 'SC-28',
    internalControlId: 'CTRL-SC-028',
    implementationSummary:
      'The platform includes data handling and retention controls, while encryption-at-rest and key management depend on infrastructure configuration.',
    coverage: 'covered' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p0' as const,
    owner: 'Data Protection',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'The platform covers data handling and retention behaviors, but encryption-at-rest and key-management proof depend on infrastructure evidence outside the platform boundary.',
    evidenceSources: ['Storage Configuration', 'Retention Jobs', 'Vendor Boundary Policy'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.312(a)(2)(iv)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The platform includes retention and file-handling controls, but encryption at rest and key-management settings remain external infrastructure choices.',
  },
  {
    nist80053Id: 'SI-4',
    internalControlId: 'CTRL-SI-004',
    implementationSummary:
      'The platform emits monitoring-relevant signals such as scan events, audit integrity checks, and telemetry posture summaries.',
    coverage: 'partial' as const,
    responsibility: 'shared-responsibility' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceAssessmentNote:
      'Monitoring-related signals exist, but alert routing, correlation, and operational review of those signals are not yet fully evidenced.',
    evidenceSources: ['Document Scan Events', 'Audit Integrity Checks', 'Telemetry Posture Summary'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'Built-in monitoring covers platform-level signals, but alert routing, correlation, and 24x7 monitoring posture remain external operating responsibilities.',
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
  responsibility: Responsibility;
  reviewStatus: ReviewStatus;
  sharedResponsibilityNotes: string;
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
        `${sourceControl.title} is tracked as an active control in the starter register.`,
      priority: blueprint.priority,
      owner: blueprint.owner,
      responsibility: blueprint.responsibility,
      reviewStatus: blueprint.reviewStatus,
      lastReviewedAt: null,
      sharedResponsibilityNotes: blueprint.sharedResponsibilityNotes,
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
