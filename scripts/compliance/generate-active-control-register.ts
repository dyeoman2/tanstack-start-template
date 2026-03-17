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

type Status =
  | 'not-applicable'
  | 'operator-owned'
  | 'partial'
  | 'platform-enforced'
  | 'shared-responsibility';

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
    status: 'shared-responsibility' as const,
    implementationScope: 'shared' as const,
    priority: 'p0' as const,
    owner: 'Identity and Access Management',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: ['auth users', 'organization membership changes', 'admin audit events'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(3)', '45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The template enforces account boundaries and admin workflows, but deployers still own workforce onboarding, termination, and periodic access review.',
  },
  {
    nist80053Id: 'AC-3',
    internalControlId: 'CTRL-AC-003',
    status: 'platform-enforced' as const,
    implementationScope: 'product' as const,
    priority: 'p0' as const,
    owner: 'Application Authorization',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'pass' as const,
    evidenceSources: [
      'route guards',
      'Convex requireAuth/requireAdmin checks',
      'authorization tests',
    ],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(4)', '45 CFR 164.312(a)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'Platform guards and server-side authorization are built in. Each deployment still needs correct role assignment and least-privilege policy choices.',
  },
  {
    nist80053Id: 'AU-2',
    internalControlId: 'CTRL-AU-002',
    status: 'platform-enforced' as const,
    implementationScope: 'product' as const,
    priority: 'p0' as const,
    owner: 'Audit and Logging',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'pass' as const,
    evidenceSources: ['auditLogs', 'auth audit plugin', 'evidenceReports'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The starter records security-relevant events, but each deployment must decide retention, alerting, and external log shipping.',
  },
  {
    nist80053Id: 'AU-6',
    internalControlId: 'CTRL-AU-006',
    status: 'partial' as const,
    implementationScope: 'shared' as const,
    priority: 'p1' as const,
    owner: 'Security Operations',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: ['evidenceReports', 'audit integrity checks', 'admin security dashboard'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(b)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The app exposes evidence and review queues, but an operator must establish review cadence, escalation, and documented follow-up.',
  },
  {
    nist80053Id: 'IA-2',
    internalControlId: 'CTRL-IA-002',
    status: 'partial' as const,
    implementationScope: 'shared' as const,
    priority: 'p0' as const,
    owner: 'Authentication',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: ['Better Auth users', 'MFA coverage summary', 'passkey enrollment'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'Authentication scaffolding is built in, but production identity proofing, MFA policy, and account lifecycle decisions remain operator-owned.',
  },
  {
    nist80053Id: 'IA-5',
    internalControlId: 'CTRL-IA-005',
    status: 'shared-responsibility' as const,
    implementationScope: 'shared' as const,
    priority: 'p1' as const,
    owner: 'Authentication',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: [
      'passkey enrollment records',
      'password reset audit events',
      'email verification policy',
    ],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.312(a)(2)(i)', '45 CFR 164.312(d)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The template supports stronger authenticators and reset auditing, but deployers must choose allowed credential types and recovery workflows.',
  },
  {
    nist80053Id: 'CP-9',
    internalControlId: 'CTRL-CP-009',
    status: 'operator-owned' as const,
    implementationScope: 'ops' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure Operations',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceSources: ['backupVerificationReports'],
    evidenceCount: 1,
    hipaaCitations: ['45 CFR 164.308(a)(7)(ii)(A)', '45 CFR 164.308(a)(7)(ii)(B)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The app can record backup verification outcomes, but the actual backup strategy and restore testing are deployment responsibilities.',
  },
  {
    nist80053Id: 'IR-4',
    internalControlId: 'CTRL-IR-004',
    status: 'operator-owned' as const,
    implementationScope: 'ops' as const,
    priority: 'p0' as const,
    owner: 'Security Incident Response',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceSources: ['incident runbooks', 'audit event export', 'evidenceReports'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.308(a)(6)', '45 CFR 164.316(b)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The product emits evidence and audit trails, but incident response procedures, contacts, and post-incident handling remain operator-owned.',
  },
  {
    nist80053Id: 'RA-5',
    internalControlId: 'CTRL-RA-005',
    status: 'operator-owned' as const,
    implementationScope: 'ops' as const,
    priority: 'p0' as const,
    owner: 'Security Engineering',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'missing' as const,
    evidenceSources: ['scanner integrations', 'dependency audit results', 'risk review notes'],
    evidenceCount: 0,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(A)', '45 CFR 164.308(a)(1)(ii)(B)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The starter does not perform vulnerability management for you. Deployers need scanning, triage, remediation, and documented risk treatment.',
  },
  {
    nist80053Id: 'SC-8',
    internalControlId: 'CTRL-SC-008',
    status: 'shared-responsibility' as const,
    implementationScope: 'shared' as const,
    priority: 'p0' as const,
    owner: 'Infrastructure and Platform Security',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: [
      'HTTPS deployment policy',
      'secure link TTL settings',
      'session transport configuration',
    ],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.312(e)(1)', '45 CFR 164.312(e)(2)(i)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The app assumes secure transport, but TLS termination, certificate management, and network edge configuration are deployment concerns.',
  },
  {
    nist80053Id: 'SC-28',
    internalControlId: 'CTRL-SC-028',
    status: 'shared-responsibility' as const,
    implementationScope: 'shared' as const,
    priority: 'p0' as const,
    owner: 'Data Protection',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: ['storage configuration', 'retentionJobs', 'vendor boundary policy'],
    evidenceCount: 2,
    hipaaCitations: ['45 CFR 164.312(a)(2)(iv)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'The template includes retention and file-handling controls, but encryption at rest and key-management settings are infrastructure choices.',
  },
  {
    nist80053Id: 'SI-4',
    internalControlId: 'CTRL-SI-004',
    status: 'partial' as const,
    implementationScope: 'shared' as const,
    priority: 'p1' as const,
    owner: 'Security Monitoring',
    reviewStatus: 'pending' as const,
    latestEvidenceStatus: 'warning' as const,
    evidenceSources: ['documentScanEvents', 'audit integrity checks', 'telemetry posture summary'],
    evidenceCount: 3,
    hipaaCitations: ['45 CFR 164.308(a)(1)(ii)(D)', '45 CFR 164.312(c)(1)'],
    nist80066: [],
    sharedResponsibilityNotes:
      'Built-in monitoring covers app-level signals, but production alerting, correlation, and 24x7 monitoring posture are external to the template.',
  },
] satisfies ReadonlyArray<{
  evidenceCount: number;
  evidenceSources: string[];
  hipaaCitations: string[];
  implementationScope: 'ops' | 'product' | 'shared';
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
  reviewStatus: ReviewStatus;
  sharedResponsibilityNotes: string;
  status: Status;
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

function statusSortValue(status: Status): number {
  switch (status) {
    case 'platform-enforced':
      return 0;
    case 'shared-responsibility':
      return 1;
    case 'partial':
      return 2;
    case 'operator-owned':
      return 3;
    case 'not-applicable':
      return 4;
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
      controlStatement:
        flattenStatement(sourceControl.statement) ??
        `${sourceControl.title} is tracked as an active control in the starter register.`,
      status: blueprint.status,
      implementationScope: blueprint.implementationScope,
      priority: blueprint.priority,
      owner: blueprint.owner,
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
                  label: reference.title,
                  mappingType: 'relationship' as const,
                },
                ...reference.keyActivities.slice(0, 2).map((activity) => ({
                  referenceId: activity.referenceId,
                  label: activity.title,
                  mappingType: 'key-activity' as const,
                })),
                ...reference.sampleQuestions.slice(0, 1).map((question) => ({
                  referenceId: question.referenceId,
                  label: question.text,
                  mappingType: 'sample-question' as const,
                })),
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

    const statusCompare = statusSortValue(left.status) - statusSortValue(right.status);
    if (statusCompare !== 0) {
      return statusCompare;
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
