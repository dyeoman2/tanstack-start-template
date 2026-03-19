import activeControlRegisterJson from '../../../../compliance/generated/active-control-register.seed.json';

export type ControlResponsibility = 'customer' | 'platform' | 'shared-responsibility';

export type ControlChecklistEvidenceType = 'file' | 'link' | 'note' | 'system';
export type ControlChecklistEvidenceSufficiency = 'missing' | 'partial' | 'sufficient';
export type SeededChecklistEvidenceType = 'link' | 'note' | 'system_snapshot';

const CONTROL_RESPONSIBILITY_DISPLAY_LABELS: Record<ControlResponsibility, string> = {
  platform: 'Platform',
  'shared-responsibility': 'Shared responsibility',
  customer: 'Customer',
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
  implementationSummary: string;
  familyId: string;
  familyTitle: string;
  internalControlId: string;
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
  platformChecklistItems: Array<{
    description: string;
    itemId: string;
    label: string;
    required: boolean;
    seed: {
      evidence: Array<{
        description: string | null;
        evidenceType: SeededChecklistEvidenceType;
        sufficiency: ControlChecklistEvidenceSufficiency;
        title: string;
        url: string | null;
      }>;
      notes: string | null;
      owner: string | null;
    };
    suggestedEvidenceTypes: ControlChecklistEvidenceType[];
    verificationMethod: string;
  }>;
  responsibility: ControlResponsibility | null;
  customerResponsibilityNotes: string | null;
  title: string;
};

type ActiveControlRegisterInput = {
  controls: Array<{
    controlStatement: string;
    implementationSummary: string;
    familyId: string;
    familyTitle: string;
    internalControlId: string;
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
    platformChecklistItems: Array<{
      description: string;
      itemId: string;
      label: string;
      required: boolean;
      seed: {
        evidence: Array<{
          description: string | null;
          evidenceType: string;
          sufficiency: string;
          title: string;
          url: string | null;
        }>;
        notes: string | null;
        owner: string | null;
      };
      suggestedEvidenceTypes: string[];
      verificationMethod: string;
    }>;
    responsibility: string | null;
    customerResponsibilityNotes: string | null;
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

function normalizeControlResponsibility(value: string | null): ControlResponsibility | null {
  switch (value) {
    case 'platform':
    case 'shared-responsibility':
    case 'customer':
    case null:
      return value;
    default:
      throw new Error(`Unsupported control responsibility: ${value}`);
  }
}

function normalizeChecklistEvidenceSufficiency(value: string): ControlChecklistEvidenceSufficiency {
  switch (value) {
    case 'missing':
    case 'partial':
    case 'sufficient':
      return value;
    default:
      throw new Error(`Unsupported checklist evidence sufficiency: ${value}`);
  }
}

function normalizeSeededChecklistEvidenceType(value: string): SeededChecklistEvidenceType {
  switch (value) {
    case 'link':
    case 'note':
    case 'system_snapshot':
      return value;
    default:
      throw new Error(`Unsupported seeded evidence type: ${value}`);
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
    label: mapping.label,
    referenceId: mapping.referenceId,
    mappingType: normalizeNist80066MappingType(mapping.mappingType),
  }));
}

function normalizeNist80066MappingType(
  value: string | null,
): ActiveControlRecord['mappings']['nist80066'][number]['mappingType'] {
  switch (value) {
    case 'key-activity':
    case 'relationship':
    case 'sample-question':
    case null:
      return value;
    default:
      return null;
  }
}

function normalizeHipaaMappingType(
  value: string | null,
): ActiveControlRecord['mappings']['hipaa'][number]['type'] {
  switch (value) {
    case 'implementation_specification':
    case 'section':
    case 'standard':
    case 'subsection':
    case null:
      return value;
    default:
      return null;
  }
}

function normalizeHipaaImplementationSpecification(
  value: string | null,
): ActiveControlRecord['mappings']['hipaa'][number]['implementationSpecification'] {
  switch (value) {
    case 'addressable':
    case 'required':
    case null:
      return value;
    default:
      return null;
  }
}

function normalizeChecklistEvidenceTypes(value: string[]): ControlChecklistEvidenceType[] {
  return value.filter(
    (item): item is ControlChecklistEvidenceType =>
      item === 'file' || item === 'link' || item === 'note' || item === 'system',
  );
}

function normalizeActiveControlRegister(value: ActiveControlRegisterInput): ActiveControlRegister {
  return {
    schemaVersion: value.schemaVersion,
    generatedAt: value.generatedAt,
    generatedFrom: {
      ...value.generatedFrom,
      soc2Source: value.generatedFrom.soc2Source ?? null,
    },
    controls: value.controls.map<ActiveControlRecord>((control) => ({
      ...control,
      priority:
        control.priority === 'p0' || control.priority === 'p1' || control.priority === 'p2'
          ? control.priority
          : (() => {
              throw new Error(`Unsupported control priority: ${control.priority}`);
            })(),
      responsibility: normalizeControlResponsibility(control.responsibility),
      mappings: {
        hipaa: control.mappings.hipaa.map((mapping) => ({
          citation: mapping.citation,
          title: mapping.title,
          type: normalizeHipaaMappingType(mapping.type),
          implementationSpecification: normalizeHipaaImplementationSpecification(
            mapping.implementationSpecification,
          ),
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
      platformChecklistItems: control.platformChecklistItems.map((item) => ({
        ...item,
        seed: {
          ...item.seed,
          evidence: item.seed.evidence.map((evidence) => ({
            ...evidence,
            evidenceType: normalizeSeededChecklistEvidenceType(evidence.evidenceType),
            sufficiency: normalizeChecklistEvidenceSufficiency(evidence.sufficiency),
          })),
        },
        suggestedEvidenceTypes: normalizeChecklistEvidenceTypes(item.suggestedEvidenceTypes),
      })),
    })),
  };
}

const activeControlRegisterInput: ActiveControlRegisterInput = activeControlRegisterJson;

export const ACTIVE_CONTROL_REGISTER = normalizeActiveControlRegister(activeControlRegisterInput);

export function getControlResponsibilityDisplayLabel(responsibility: ControlResponsibility | null) {
  return responsibility ? CONTROL_RESPONSIBILITY_DISPLAY_LABELS[responsibility] : '—';
}
