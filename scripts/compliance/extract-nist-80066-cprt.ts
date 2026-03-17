import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CprtElement = {
  doc_identifier: string;
  element_identifier: string;
  element_type: string;
  text: string;
  title: string;
};

type CprtRelationship = {
  dest_doc_identifier: string;
  dest_element_identifier: string;
  provenance_doc_identifier: string;
  relationship_identifier: string;
  source_doc_identifier: string;
  source_element_identifier: string;
};

type CprtPayload = {
  response: {
    elements: {
      documents: Array<{
        doc_identifier: string;
        name: string;
        version: string;
        website: string;
      }>;
      elements: CprtElement[];
      relationship_types: Array<{
        description: string;
        relationship_identifier: string;
      }>;
      relationships: CprtRelationship[];
    };
    requestType: number;
  };
};

type Nist80066Element = {
  elementType: string;
  referenceId: string;
  text: string;
  title: string;
};

const SOURCE_PATH = path.resolve(
  process.cwd(),
  'compliance/sources/nist/800-66/SP800_66_2_0_0-cprt-export.json',
);
const OUTPUT_PATH = path.resolve(process.cwd(), 'compliance/generated/nist-800-66-controls.json');

function toCitation(value: string): string {
  return `45 CFR ${value}`;
}

function parseSampleQuestionBase(identifier: string): string | null {
  const raw = identifier.replace(/^SQ_/, '');
  const segments = raw.split('.');

  while (segments.length > 0) {
    const last = segments.at(-1) ?? '';
    if (/^\d+$/.test(last)) {
      segments.pop();
      continue;
    }
    break;
  }

  const candidate = segments.join('.');
  return /^164\.\d+(?:\([^)]+\))*$/.test(candidate) ? candidate : null;
}

function parseCrosswalkBase(identifier: string): string | null {
  const match = identifier.match(/^PC_(164\.\d+(?:\([^)]+\))*)(?:\.\d+)+$/);
  return match ? match[1] : null;
}

async function main() {
  const raw = await readFile(SOURCE_PATH, 'utf8');
  const payload = JSON.parse(raw) as CprtPayload;
  const source = payload.response.elements;

  const primaryElements = source.elements.filter((element) =>
    ['security_rule', 'standard', 'imp_spec'].includes(element.element_type),
  );
  const elementMap = new Map(
    source.elements.map((element) => [element.element_identifier, element]),
  );

  const keyActivitiesByCitation = new Map<string, Nist80066Element[]>();
  for (const relationship of source.relationships) {
    if (!relationship.source_element_identifier.startsWith('KA_')) {
      continue;
    }

    const keyActivity = elementMap.get(relationship.source_element_identifier);
    if (!keyActivity) {
      continue;
    }

    const citation = toCitation(relationship.dest_element_identifier);
    const existing = keyActivitiesByCitation.get(citation) ?? [];
    if (!existing.some((item) => item.referenceId === keyActivity.element_identifier)) {
      existing.push({
        referenceId: keyActivity.element_identifier,
        elementType: keyActivity.element_type,
        title: keyActivity.title,
        text: keyActivity.text,
      });
    }
    keyActivitiesByCitation.set(citation, existing);
  }

  const sampleQuestionsByCitation = new Map<string, Nist80066Element[]>();
  for (const element of source.elements) {
    if (element.element_type !== 'sample_question') {
      continue;
    }

    const base = parseSampleQuestionBase(element.element_identifier);
    if (!base) {
      continue;
    }

    const citation = toCitation(base);
    const existing = sampleQuestionsByCitation.get(citation) ?? [];
    existing.push({
      referenceId: element.element_identifier,
      elementType: element.element_type,
      title: element.title,
      text: element.text,
    });
    sampleQuestionsByCitation.set(citation, existing);
  }

  const crosswalksByCitation = new Map<string, Nist80066Element[]>();
  for (const element of source.elements) {
    if (element.element_type !== 'pub_crosswalk') {
      continue;
    }

    const base = parseCrosswalkBase(element.element_identifier);
    if (!base) {
      continue;
    }

    const citation = toCitation(base);
    const existing = crosswalksByCitation.get(citation) ?? [];
    existing.push({
      referenceId: element.element_identifier,
      elementType: element.element_type,
      title: element.title,
      text: element.text,
    });
    crosswalksByCitation.set(citation, existing);
  }

  const citations = primaryElements
    .map((element) => {
      const citation = toCitation(element.element_identifier);
      return {
        citation,
        referenceId: element.element_identifier,
        elementType: element.element_type,
        title: element.title,
        text: element.text,
        keyActivities: keyActivitiesByCitation.get(citation) ?? [],
        sampleQuestions: sampleQuestionsByCitation.get(citation) ?? [],
        publicationCrosswalks: crosswalksByCitation.get(citation) ?? [],
      };
    })
    .sort((left, right) => left.citation.localeCompare(right.citation));

  const output = {
    generatedAt: new Date().toISOString(),
    sourcePath: path.relative(process.cwd(), SOURCE_PATH),
    document: source.documents[0] ?? null,
    citationCount: citations.length,
    citations,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Extracted ${citations.length} normalized SP 800-66 citations.`);
}

await main();
