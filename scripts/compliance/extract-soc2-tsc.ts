import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';

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

type Soc2PointOfFocus = {
  frameworkReference: string;
  frameworkSpecificPointOfFocus: string | null;
  normalizedNist80053Id: string | null;
};

type Soc2Criterion = {
  criterionId: string;
  group: Soc2CriterionGroup;
  pointOfFocusMappings: Soc2PointOfFocus[];
  title: string;
  trustServiceCategory: Soc2TrustServiceCategory;
};

type Soc2IndexEntry = {
  criterionId: string;
  group: Soc2CriterionGroup;
  title: string;
  trustServiceCategory: Soc2TrustServiceCategory;
};

const SOURCE_XLSX_PATH = path.resolve(
  process.cwd(),
  'compliance/sources/aicpa/soc-2/tsc_to_nist_800-53.xlsx',
);
const SOURCE_FILES = [
  'compliance/sources/aicpa/soc-2/Trust-services-criteria.pdf',
  'compliance/sources/aicpa/soc-2/Description Criteria.pdf',
  'compliance/sources/aicpa/soc-2/tsc_to_nist_800-53.xlsx',
] as const;
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/soc-2-trust-services-criteria.json',
);

function normalizeCriterionHeader(value: string): { criterionId: string; title: string } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^([A-Z]{1,2}\d+\.\d+):\s*(.+)$/);

  if (!match) {
    return null;
  }

  return {
    criterionId: match[1].trim(),
    title: match[2].trim(),
  };
}

function getCriterionGroup(criterionId: string): Soc2CriterionGroup {
  if (criterionId.startsWith('CC')) {
    return 'common-criteria';
  }

  if (criterionId.startsWith('A')) {
    return 'availability';
  }

  if (criterionId.startsWith('C')) {
    return 'confidentiality';
  }

  if (criterionId.startsWith('PI')) {
    return 'processing-integrity';
  }

  if (criterionId.startsWith('P')) {
    return 'privacy';
  }

  throw new Error(`Unsupported SOC 2 criterion prefix for ${criterionId}`);
}

function getTrustServiceCategory(criterionId: string): Soc2TrustServiceCategory {
  if (criterionId.startsWith('CC')) {
    return 'security';
  }

  if (criterionId.startsWith('A')) {
    return 'availability';
  }

  if (criterionId.startsWith('C')) {
    return 'confidentiality';
  }

  if (criterionId.startsWith('PI')) {
    return 'processing-integrity';
  }

  if (criterionId.startsWith('P')) {
    return 'privacy';
  }

  throw new Error(`Unsupported SOC 2 trust service category for ${criterionId}`);
}

function normalizeNistControlId(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^([A-Z]{2,3})-(\d+)/);

  if (!match) {
    return null;
  }

  return `${match[1]}-${Number.parseInt(match[2], 10)}`;
}

async function main() {
  const rows = await readXlsxFile(SOURCE_XLSX_PATH, {
    sheet: 'NIST 800-53 as Points of Focus',
  });

  let currentCriterionId: string | null = null;
  const criteria = new Map<string, Soc2Criterion>();

  for (const row of rows) {
    const [criterionCell, frameworkReferenceCell, pointOfFocusCell] = row;

    if (typeof criterionCell === 'string') {
      const header = normalizeCriterionHeader(criterionCell);
      if (header) {
        currentCriterionId = header.criterionId;
        criteria.set(header.criterionId, {
          criterionId: header.criterionId,
          title: header.title,
          group: getCriterionGroup(header.criterionId),
          trustServiceCategory: getTrustServiceCategory(header.criterionId),
          pointOfFocusMappings: [],
        });
        continue;
      }
    }

    if (
      currentCriterionId === null ||
      typeof frameworkReferenceCell !== 'string' ||
      frameworkReferenceCell.trim().length === 0 ||
      frameworkReferenceCell.trim() === 'FRAMEWORK REFERENCE' ||
      frameworkReferenceCell.trim() === 'None'
    ) {
      continue;
    }

    const criterion = criteria.get(currentCriterionId);
    if (!criterion) {
      continue;
    }

    criterion.pointOfFocusMappings.push({
      frameworkReference: frameworkReferenceCell.trim(),
      frameworkSpecificPointOfFocus:
        typeof pointOfFocusCell === 'string' && pointOfFocusCell.trim().length > 0
          ? pointOfFocusCell.trim()
          : null,
      normalizedNist80053Id: normalizeNistControlId(frameworkReferenceCell),
    });
  }

  const criteriaList = Array.from(criteria.values()).sort((left, right) =>
    left.criterionId.localeCompare(right.criterionId),
  );

  const nist80053Index = Object.fromEntries(
    Object.entries(
      criteriaList.reduce<Record<string, Soc2IndexEntry[]>>((accumulator, criterion) => {
        for (const mapping of criterion.pointOfFocusMappings) {
          if (!mapping.normalizedNist80053Id) {
            continue;
          }

          const existing = accumulator[mapping.normalizedNist80053Id] ?? [];
          if (!existing.some((candidate) => candidate.criterionId === criterion.criterionId)) {
            existing.push({
              criterionId: criterion.criterionId,
              group: criterion.group,
              title: criterion.title,
              trustServiceCategory: criterion.trustServiceCategory,
            });
          }
          accumulator[mapping.normalizedNist80053Id] = existing;
        }

        return accumulator;
      }, {}),
    ).map(([controlId, entries]) => [
      controlId,
      entries.sort((left, right) => left.criterionId.localeCompare(right.criterionId)),
    ]),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles: SOURCE_FILES,
    sourceSheet: 'NIST 800-53 as Points of Focus',
    criteriaCount: criteriaList.length,
    criteria: criteriaList,
    indexes: {
      nist80053: nist80053Index,
    },
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Extracted ${criteriaList.length} SOC 2 criteria with 800-53 mappings.`);
}

await main();
