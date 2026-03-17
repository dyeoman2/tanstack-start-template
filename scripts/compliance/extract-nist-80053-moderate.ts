import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type OscalProperty = {
  name?: string;
  value?: string;
};

type OscalParameter = {
  id: string;
  label?: string;
  select?: {
    choice?: Array<{
      value?: string;
    }>;
  };
  values?: string[];
};

type OscalPart = {
  id?: string;
  name?: string;
  prose?: string;
  props?: OscalProperty[];
  parts?: OscalPart[];
};

type OscalLink = {
  href?: string;
  rel?: string;
};

type OscalControl = {
  id: string;
  class?: string;
  title?: string;
  params?: OscalParameter[];
  parts?: OscalPart[];
  props?: OscalProperty[];
  links?: OscalLink[];
  controls?: OscalControl[];
};

type OscalGroup = {
  id: string;
  title?: string;
  class?: string;
  controls?: OscalControl[];
};

type OscalCatalog = {
  catalog: {
    metadata?: {
      lastModified?: string;
      title?: string;
      version?: string;
    };
    groups?: OscalGroup[];
  };
};

type ExtractedControl = {
  nist80053Id: string;
  title: string;
  familyId: string;
  familyTitle: string;
  controlClass: string | null;
  statement: string[];
  guidance: string | null;
  parameters: Array<{
    id: string;
    label: string | null;
    choices: string[];
    values: string[];
  }>;
  assessmentObjectives: string[];
  assessmentMethods: Array<{
    method: string | null;
    objects: string | null;
  }>;
  enhancements: string[];
  sourceLinks: string[];
};

const SOURCE_PATH = path.resolve(
  process.cwd(),
  'compliance/sources/nist/800-53/NIST_SP-800-53_rev5_MODERATE-baseline-resolved-profile_catalog.json',
);
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/nist-800-53-moderate-controls.json',
);

function getPropValue(props: OscalProperty[] | undefined, name: string): string | null {
  return props?.find((prop) => prop.name === name)?.value ?? null;
}

function collectProse(parts: OscalPart[] | undefined): string[] {
  if (!parts) {
    return [];
  }

  const results: string[] = [];

  for (const part of parts) {
    if (typeof part.prose === 'string' && part.prose.trim().length > 0) {
      results.push(part.prose.trim());
    }

    results.push(...collectProse(part.parts));
  }

  return results;
}

function normalizeMultilineText(value: string): string {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function extractStatement(control: OscalControl): string[] {
  const statementPart = control.parts?.find((part) => part.name === 'statement');
  return collectProse(statementPart?.parts).map(normalizeMultilineText);
}

function extractGuidance(control: OscalControl): string | null {
  const guidancePart = control.parts?.find((part) => part.name === 'guidance');
  if (!guidancePart?.prose) {
    return null;
  }

  return normalizeMultilineText(guidancePart.prose);
}

function extractAssessmentObjectives(control: OscalControl): string[] {
  const objectivePart = control.parts?.find((part) => part.name === 'assessment-objective');
  return collectProse(objectivePart?.parts).map(normalizeMultilineText);
}

function extractAssessmentMethods(control: OscalControl) {
  return (control.parts ?? [])
    .filter((part) => part.name === 'assessment-method')
    .map((part) => ({
      method: getPropValue(part.props, 'method'),
      objects: part.parts
        ?.filter((child) => child.name === 'assessment-objects')
        .map((child) => child.prose ?? '')
        .filter((value) => value.trim().length > 0)
        .map(normalizeMultilineText)
        .join('\n\n') || null,
    }));
}

function extractParameters(control: OscalControl) {
  return (control.params ?? []).map((param) => ({
    id: param.id,
    label: param.label ?? null,
    choices: (param.select?.choice ?? [])
      .map((choice) => choice.value?.trim() ?? '')
      .filter((value) => value.length > 0),
    values: (param.values ?? []).map((value) => value.trim()).filter((value) => value.length > 0),
  }));
}

function flattenControls(group: OscalGroup, controls: OscalControl[]): ExtractedControl[] {
  const results: ExtractedControl[] = [];

  for (const control of controls) {
    results.push({
      nist80053Id: control.id.toUpperCase(),
      title: control.title ?? control.id.toUpperCase(),
      familyId: group.id.toUpperCase(),
      familyTitle: group.title ?? group.id.toUpperCase(),
      controlClass: control.class ?? null,
      statement: extractStatement(control),
      guidance: extractGuidance(control),
      parameters: extractParameters(control),
      assessmentObjectives: extractAssessmentObjectives(control),
      assessmentMethods: extractAssessmentMethods(control),
      enhancements: (control.controls ?? []).map((enhancement) => enhancement.id.toUpperCase()),
      sourceLinks: (control.links ?? [])
        .map((link) => link.href?.trim() ?? '')
        .filter((href) => href.length > 0),
    });

    if (control.controls && control.controls.length > 0) {
      results.push(...flattenControls(group, control.controls));
    }
  }

  return results;
}

async function main() {
  const raw = await readFile(SOURCE_PATH, 'utf8');
  const document = JSON.parse(raw) as OscalCatalog;
  const groups = document.catalog.groups ?? [];

  const extracted = groups.flatMap((group) => flattenControls(group, group.controls ?? []));

  const output = {
    generatedAt: new Date().toISOString(),
    sourcePath: path.relative(process.cwd(), SOURCE_PATH),
    sourceMetadata: document.catalog.metadata ?? null,
    controlCount: extracted.length,
    familyCount: groups.length,
    families: groups.map((group) => ({
      id: group.id.toUpperCase(),
      title: group.title ?? group.id.toUpperCase(),
      controlCount: flattenControls(group, group.controls ?? []).length,
    })),
    controls: extracted,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.info(
    JSON.stringify(
      {
        outputPath: path.relative(process.cwd(), OUTPUT_PATH),
        controlCount: output.controlCount,
        familyCount: output.familyCount,
      },
      null,
      2,
    ),
  );
}

await main();
