import activeControlRegisterJson from '../../../../compliance/generated/active-control-register.seed.json';

export type ControlCoverage = 'covered' | 'not-applicable' | 'not-covered' | 'partial';
export type ControlResponsibility = 'operator-owned' | 'platform' | 'shared-responsibility';

export type ReviewStatus = 'needs-follow-up' | 'pending' | 'reviewed';
export type EvidenceStatus = 'fail' | 'missing' | 'not-tested' | 'pass' | 'warning';

export const CONTROL_COVERAGE_DISPLAY_LABELS: Record<ControlCoverage, string> = {
  covered: 'Covered',
  partial: 'Partial',
  'not-covered': 'Not covered',
  'not-applicable': 'Not applicable',
};

export const CONTROL_RESPONSIBILITY_DISPLAY_LABELS: Record<ControlResponsibility, string> = {
  platform: 'Platform',
  'shared-responsibility': 'Shared responsibility',
  'operator-owned': 'Operator-owned',
};

export type ActiveControlRegister = {
  controls: ActiveControlRecord[];
  generatedAt: string;
  generatedFrom: {
    csf20Source: string | null;
    hipaaSource: string;
    nist80053ModerateSource: string;
    nist80066Source: string | null;
    soc2Source: string | null;
  };
  schemaVersion: string;
};

export type ActiveControlRecord = {
  controlStatement: string;
  coverage: ControlCoverage;
  implementationSummary: string;
  evidence: {
    assessmentNote: string;
    evidenceCount: number;
    evidenceSources: string[];
    latestEvidenceStatus: EvidenceStatus;
  };
  familyId: string;
  familyTitle: string;
  internalControlId: string;
  lastReviewedAt: string | null;
  mappings: {
    csf20: Array<{
      label: string | null;
      subcategoryId: string;
    }>;
    hipaa: Array<{
      citation: string;
      implementationSpecification: 'addressable' | 'required' | null;
      title: string | null;
      type: 'implementation_specification' | 'section' | 'standard' | 'subsection' | null;
    }>;
    nist80066: Array<{
      label: string | null;
      mappingType: 'key-activity' | 'relationship' | 'sample-question' | null;
      referenceId: string;
    }>;
    soc2: Array<{
      criterionId: string;
      group:
        | 'availability'
        | 'common-criteria'
        | 'confidentiality'
        | 'privacy'
        | 'processing-integrity';
      label: string | null;
      trustServiceCategory:
        | 'availability'
        | 'confidentiality'
        | 'privacy'
        | 'processing-integrity'
        | 'security';
    }>;
  };
  nist80053Id: string;
  owner: string;
  priority: 'p0' | 'p1' | 'p2';
  responsibility: ControlResponsibility | null;
  reviewStatus: ReviewStatus;
  sharedResponsibilityNotes: string | null;
  title: string;
};

type ActiveControlRegisterInput = {
  controls: Array<{
    controlStatement: string;
    coverage: string;
    implementationSummary: string;
    evidence: {
      assessmentNote: string;
      evidenceCount: number;
      evidenceSources: string[];
      latestEvidenceStatus: string;
    };
    familyId: string;
    familyTitle: string;
    internalControlId: string;
    lastReviewedAt: string | null;
    mappings: {
      csf20: Array<{
        label: string | null;
        subcategoryId: string;
      }>;
      hipaa: Array<{
        citation: string;
        implementationSpecification: string | null;
        title: string | null;
        type: string | null;
      }>;
      nist80066: Array<{
        label: string | null;
        mappingType: string | null;
        referenceId: string;
      }>;
      soc2?: Array<{
        criterionId: string;
        group: string;
        label: string | null;
        trustServiceCategory: string;
      }>;
    };
    nist80053Id: string;
    owner: string;
    priority: string;
    responsibility: string | null;
    reviewStatus: string;
    sharedResponsibilityNotes: string | null;
    title: string;
  }>;
  generatedAt: string;
  generatedFrom: {
    csf20Source: string | null;
    hipaaSource: string;
    nist80053ModerateSource: string;
    nist80066Source: string | null;
    soc2Source?: string | null;
  };
  schemaVersion: string;
};

function normalizeControlCoverage(value: string): ControlCoverage {
  switch (value) {
    case 'covered':
    case 'partial':
    case 'not-covered':
    case 'not-applicable':
      return value;
    default:
      throw new Error(`Unsupported control coverage: ${value}`);
  }
}

function normalizeControlResponsibility(value: string | null): ControlResponsibility | null {
  switch (value) {
    case 'platform':
    case 'shared-responsibility':
    case 'operator-owned':
    case null:
      return value;
    default:
      throw new Error(`Unsupported control responsibility: ${value}`);
  }
}

function normalizeReviewStatus(value: string): ReviewStatus {
  switch (value) {
    case 'pending':
    case 'reviewed':
    case 'needs-follow-up':
      return value;
    default:
      throw new Error(`Unsupported review status: ${value}`);
  }
}

function normalizeEvidenceStatus(value: string): EvidenceStatus {
  switch (value) {
    case 'pass':
    case 'warning':
    case 'fail':
    case 'missing':
    case 'not-tested':
      return value;
    default:
      throw new Error(`Unsupported evidence status: ${value}`);
  }
}

function normalizeNist80066Mappings(
  value: Array<{
    label: string | null;
    mappingType: string | null;
    referenceId: string;
  }>,
): ActiveControlRecord['mappings']['nist80066'] {
  return value.map((mapping) => ({
    ...mapping,
    mappingType:
      mapping.mappingType === 'key-activity' ||
      mapping.mappingType === 'relationship' ||
      mapping.mappingType === 'sample-question' ||
      mapping.mappingType === null
        ? mapping.mappingType
        : null,
  }));
}

function normalizeActiveControlRegister(
  value: ActiveControlRegisterInput,
): ActiveControlRegister {
  return {
    schemaVersion: value.schemaVersion,
    generatedAt: value.generatedAt,
    generatedFrom: {
      ...value.generatedFrom,
      soc2Source: value.generatedFrom.soc2Source ?? null,
    },
    controls: value.controls.map((control) => ({
      ...control,
      coverage: normalizeControlCoverage(control.coverage),
      priority:
        control.priority === 'p0' || control.priority === 'p1' || control.priority === 'p2'
          ? control.priority
          : (() => {
              throw new Error(`Unsupported control priority: ${control.priority}`);
            })(),
      responsibility: normalizeControlResponsibility(control.responsibility),
      reviewStatus: normalizeReviewStatus(control.reviewStatus),
      mappings: {
        hipaa: control.mappings.hipaa.map((mapping) => ({
          ...mapping,
          type:
            mapping.type === 'implementation_specification' ||
            mapping.type === 'section' ||
            mapping.type === 'standard' ||
            mapping.type === 'subsection' ||
            mapping.type === null
              ? mapping.type
              : null,
          implementationSpecification:
            mapping.implementationSpecification === 'addressable' ||
            mapping.implementationSpecification === 'required' ||
            mapping.implementationSpecification === null
              ? mapping.implementationSpecification
              : null,
        })),
        csf20: control.mappings.csf20.map((mapping) => ({
          ...mapping,
        })),
        nist80066: normalizeNist80066Mappings(control.mappings.nist80066),
        soc2: (control.mappings.soc2 ?? []).map((mapping) => ({
          ...mapping,
          group:
            mapping.group === 'availability' ||
            mapping.group === 'common-criteria' ||
            mapping.group === 'confidentiality' ||
            mapping.group === 'privacy' ||
            mapping.group === 'processing-integrity'
              ? mapping.group
              : 'common-criteria',
          trustServiceCategory:
            mapping.trustServiceCategory === 'availability' ||
            mapping.trustServiceCategory === 'confidentiality' ||
            mapping.trustServiceCategory === 'privacy' ||
            mapping.trustServiceCategory === 'processing-integrity' ||
            mapping.trustServiceCategory === 'security'
              ? mapping.trustServiceCategory
              : 'security',
        })),
      },
      evidence: {
        ...control.evidence,
        latestEvidenceStatus: normalizeEvidenceStatus(control.evidence.latestEvidenceStatus),
      },
    })),
  };
}

const activeControlRegisterInput: ActiveControlRegisterInput = activeControlRegisterJson;

export const ACTIVE_CONTROL_REGISTER = normalizeActiveControlRegister(activeControlRegisterInput);

export function getControlCoverageDisplayLabel(coverage: ControlCoverage) {
  return CONTROL_COVERAGE_DISPLAY_LABELS[coverage];
}

export function getControlResponsibilityDisplayLabel(
  responsibility: ControlResponsibility | null,
) {
  return responsibility ? CONTROL_RESPONSIBILITY_DISPLAY_LABELS[responsibility] : '—';
}

export function getActiveControlRegisterSummary() {
  const controls = ACTIVE_CONTROL_REGISTER.controls;

  const byCoverage = controls.reduce<Record<ControlCoverage, number>>(
    (accumulator, control) => {
      accumulator[control.coverage] += 1;
      return accumulator;
    },
    {
      covered: 0,
      partial: 0,
      'not-covered': 0,
      'not-applicable': 0,
    },
  );

  const byResponsibility = controls.reduce<Record<ControlResponsibility, number>>(
    (accumulator, control) => {
      if (control.responsibility) {
        accumulator[control.responsibility] += 1;
      }
      return accumulator;
    },
    {
      platform: 0,
      'shared-responsibility': 0,
      'operator-owned': 0,
    },
  );

  const byEvidence = controls.reduce<Record<EvidenceStatus, number>>(
    (accumulator, control) => {
      accumulator[control.evidence.latestEvidenceStatus] += 1;
      return accumulator;
    },
    {
      pass: 0,
      warning: 0,
      fail: 0,
      missing: 0,
      'not-tested': 0,
    },
  );

  const overdueReviewCount = controls.filter(
    (control) => control.reviewStatus !== 'reviewed',
  ).length;

  return {
    totalControls: controls.length,
    byCoverage,
    byResponsibility,
    byEvidence,
    overdueReviewCount,
  };
}
