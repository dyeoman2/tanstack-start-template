import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CitationRecord = {
  citation: string;
  shortId: string;
  title: string;
  type: 'section' | 'subsection' | 'standard' | 'implementation_specification' | 'clause';
  parentCitation: string | null;
  implementationSpecification: 'required' | 'addressable' | null;
  text: string;
  sourceSectionCitation: string;
  sourceSectionTitle: string;
  sourceVersionDate: string;
};

const SOURCE_PATH = path.resolve(
  process.cwd(),
  'compliance/sources/hhs/hipaa/title-45-part-164-subpart-c-2026-03-13.xml',
);
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  'compliance/mappings/hipaa-security-rule-citations.json',
);
const SOURCE_VERSION_DATE = '2026-03-13';
const SOURCE_URL =
  'https://www.ecfr.gov/api/versioner/v1/full/2026-03-13/title-45.xml?part=164&subpart=C';

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function normalizeTitle(head: string): string {
  return stripTags(head)
    .replace(/^§\s*\d+\.\d+\s*/, '')
    .replace(/\.$/, '')
    .trim();
}

function extractParagraphs(sectionBlock: string): string[] {
  const matches = [...sectionBlock.matchAll(/<P>([\s\S]*?)<\/P>/g)];
  return matches.map((match) => match[1].trim()).filter((value) => value.length > 0);
}

function getGroups(prefix: string): string[] {
  return [...prefix.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
}

function buildCitation(sectionId: string, groups: string[]): string {
  return `45 CFR ${sectionId}${groups.map((group) => `(${group})`).join('')}`;
}

function isRomanNumeral(value: string): boolean {
  return /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(value);
}

function sectionFromCitation(citation: string): string {
  const match = citation.match(/^45 CFR (\d+\.\d+)/);
  return match ? match[1] : citation;
}

function citationGroupsFromCitation(citation: string): string[] {
  return [...citation.matchAll(/\(([^)]+)\)/g)].map((match) => match[1]);
}

function firstAlphaGroup(groups: string[]): string | null {
  const alpha = groups.find((group) => /^[a-z]$/i.test(group));
  return alpha ?? null;
}

function mergeWithSubsectionBase(
  subsectionBaseGroups: string[],
  groups: string[],
  options?: {
    dropTrailingRoman?: boolean;
  },
): string[] {
  const nextGroups = [...groups];

  if (
    options?.dropTrailingRoman &&
    nextGroups.length > 0 &&
    isRomanNumeral(nextGroups.at(-1) ?? '')
  ) {
    nextGroups.pop();
  }

  if (nextGroups.length === 0) {
    return [...subsectionBaseGroups];
  }

  if (/^[a-z]$/i.test(nextGroups[0])) {
    return nextGroups;
  }

  return [...subsectionBaseGroups, ...nextGroups];
}

function pushRecord(records: CitationRecord[], record: CitationRecord) {
  if (!records.some((existing) => existing.citation === record.citation)) {
    records.push(record);
  }
}

function citationQualityScore(record: CitationRecord): number {
  if (record.type === 'section') {
    return 100;
  }

  let score = 0;
  if (/^45 CFR 164\.\d+\([a-z]/i.test(record.citation)) {
    score += 50;
  }

  score += citationGroupsFromCitation(record.citation).length * 5;

  if (record.implementationSpecification !== null) {
    score += 10;
  }

  return score;
}

function dedupeRecords(records: CitationRecord[]): CitationRecord[] {
  const grouped = new Map<string, CitationRecord[]>();

  for (const record of records) {
    const key = [
      record.sourceSectionCitation,
      record.type,
      record.title,
      record.text,
      record.implementationSpecification ?? '',
    ].join('||');
    const existing = grouped.get(key) ?? [];
    existing.push(record);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map(
    (group) =>
      group.sort((left, right) => citationQualityScore(right) - citationQualityScore(left))[0],
  );
}

async function main() {
  const xml = await readFile(SOURCE_PATH, 'utf8');
  const sectionMatches = [...xml.matchAll(/<DIV8 N="(164\.\d+)"[\s\S]*?<\/DIV8>/g)];
  const records: CitationRecord[] = [];

  for (const sectionMatch of sectionMatches) {
    const sectionId = sectionMatch[1];
    const block = sectionMatch[0];
    const headMatch = block.match(/<HEAD>([\s\S]*?)<\/HEAD>/);
    if (!headMatch) {
      continue;
    }

    const sectionTitle = normalizeTitle(headMatch[1]);
    const sectionCitation = `45 CFR ${sectionId}`;

    pushRecord(records, {
      citation: sectionCitation,
      shortId: sectionId,
      title: sectionTitle,
      type: 'section',
      parentCitation: null,
      implementationSpecification: null,
      text: sectionTitle,
      sourceSectionCitation: sectionCitation,
      sourceSectionTitle: sectionTitle,
      sourceVersionDate: SOURCE_VERSION_DATE,
    });

    const paragraphs = extractParagraphs(block);
    let currentStandardCitation: string | null = null;
    let currentSubsectionBaseGroups: string[] = [];
    let currentImplementationPrefixGroups: string[] | null = null;

    for (const rawParagraph of paragraphs) {
      const standardMatch = rawParagraph.match(
        /^((?:\([^)]+\))+)\s*<I>Standard:\s*([^<]+?)\.<\/I>\s*([\s\S]*)$/i,
      );
      if (standardMatch) {
        const groups = getGroups(standardMatch[1]);
        const citationGroups = mergeWithSubsectionBase(currentSubsectionBaseGroups, groups, {
          dropTrailingRoman: true,
        });
        const citation = buildCitation(sectionId, citationGroups);
        const title = stripTags(standardMatch[2]);
        const text = stripTags(standardMatch[3]);
        currentStandardCitation = citation;
        const alphaGroup = firstAlphaGroup(citationGroups);
        currentSubsectionBaseGroups = alphaGroup ? [alphaGroup] : [];
        currentImplementationPrefixGroups = null;

        pushRecord(records, {
          citation,
          shortId: citation.replace(/^45 CFR /, ''),
          title,
          type: 'standard',
          parentCitation: sectionCitation,
          implementationSpecification: null,
          text,
          sourceSectionCitation: sectionCitation,
          sourceSectionTitle: sectionTitle,
          sourceVersionDate: SOURCE_VERSION_DATE,
        });
        continue;
      }

      const specialInlineImplementationMatch = rawParagraph.match(
        /^((?:\([^)]+\))+)\s*<I>Implementation specifications?(?:\s*\((Required|Addressable)\))?<\/I>[^<]*((?:\([^)]+\))+)\s*<I>([^<]+?)\.<\/I>\s*([\s\S]*)$/i,
      );
      if (specialInlineImplementationMatch) {
        const containerGroups = getGroups(specialInlineImplementationMatch[1]);
        const childGroups = getGroups(specialInlineImplementationMatch[3]);
        const title = stripTags(specialInlineImplementationMatch[4]);
        const text = stripTags(specialInlineImplementationMatch[5]);
        const implementationSpecification = (specialInlineImplementationMatch[2]?.toLowerCase() ??
          null) as CitationRecord['implementationSpecification'];
        const citationGroups = [
          ...mergeWithSubsectionBase(currentSubsectionBaseGroups, containerGroups),
          ...childGroups,
        ];
        const citation = buildCitation(sectionId, citationGroups);
        currentImplementationPrefixGroups = mergeWithSubsectionBase(
          currentSubsectionBaseGroups,
          containerGroups,
        );

        pushRecord(records, {
          citation,
          shortId: citation.replace(/^45 CFR /, ''),
          title,
          type: 'implementation_specification',
          parentCitation: currentStandardCitation ?? sectionCitation,
          implementationSpecification,
          text,
          sourceSectionCitation: sectionCitation,
          sourceSectionTitle: sectionTitle,
          sourceVersionDate: SOURCE_VERSION_DATE,
        });
        continue;
      }

      const implementationHeaderMatch = rawParagraph.match(
        /^((?:\([^)]+\))+)\s*<I>Implementation specifications?\.?:?<\/I>\s*([\s\S]*)$/i,
      );
      if (implementationHeaderMatch) {
        const groups = getGroups(implementationHeaderMatch[1]);
        currentImplementationPrefixGroups =
          groups.length === 1 && isRomanNumeral(groups[0]) && currentStandardCitation !== null
            ? [...citationGroupsFromCitation(currentStandardCitation), ...groups]
            : mergeWithSubsectionBase(currentSubsectionBaseGroups, groups);
        const trailingText = stripTags(implementationHeaderMatch[2]);
        if (trailingText.length > 0 && currentImplementationPrefixGroups.length > 0) {
          const citation = buildCitation(sectionId, currentImplementationPrefixGroups);
          pushRecord(records, {
            citation,
            shortId: citation.replace(/^45 CFR /, ''),
            title: 'Implementation specifications',
            type: 'subsection',
            parentCitation: currentStandardCitation ?? sectionCitation,
            implementationSpecification: null,
            text: trailingText,
            sourceSectionCitation: sectionCitation,
            sourceSectionTitle: sectionTitle,
            sourceVersionDate: SOURCE_VERSION_DATE,
          });
        }
        continue;
      }

      const inlineImplementationSpecMatch = rawParagraph.match(
        /^((?:\([^)]+\))+)\s*<I>Implementation specifications?\.?:?\s*([^<(]+?)\s*\((Required|Addressable)\)\.<\/I>\s*([\s\S]*)$/i,
      );
      if (inlineImplementationSpecMatch) {
        const groups = getGroups(inlineImplementationSpecMatch[1]);
        const title = stripTags(inlineImplementationSpecMatch[2]);
        const text = stripTags(inlineImplementationSpecMatch[4]);
        const implementationSpecification = inlineImplementationSpecMatch[3].toLowerCase() as
          | 'required'
          | 'addressable';
        const citationGroups =
          groups.length === 1 && isRomanNumeral(groups[0]) && currentStandardCitation !== null
            ? [...citationGroupsFromCitation(currentStandardCitation), ...groups]
            : mergeWithSubsectionBase(currentSubsectionBaseGroups, groups);
        const citation = buildCitation(sectionId, citationGroups);

        pushRecord(records, {
          citation,
          shortId: citation.replace(/^45 CFR /, ''),
          title,
          type: 'implementation_specification',
          parentCitation: sectionCitation,
          implementationSpecification,
          text,
          sourceSectionCitation: sectionCitation,
          sourceSectionTitle: sectionTitle,
          sourceVersionDate: SOURCE_VERSION_DATE,
        });
        continue;
      }

      const titledImplementationMatch = rawParagraph.match(
        /^((?:\([^)]+\))+)\s*<I>([^<(]+?)(?:\s*\((Required|Addressable)\))?\.<\/I>\s*([\s\S]*)$/i,
      );
      if (titledImplementationMatch && currentImplementationPrefixGroups) {
        const itemGroups = getGroups(titledImplementationMatch[1]);
        const title = stripTags(titledImplementationMatch[2]);
        const text = stripTags(titledImplementationMatch[4]);
        const implementationSpecification = (titledImplementationMatch[3]?.toLowerCase() ??
          null) as CitationRecord['implementationSpecification'];
        const citation = buildCitation(sectionId, [
          ...currentImplementationPrefixGroups,
          ...itemGroups,
        ]);

        pushRecord(records, {
          citation,
          shortId: citation.replace(/^45 CFR /, ''),
          title,
          type: 'implementation_specification',
          parentCitation: currentStandardCitation ?? sectionCitation,
          implementationSpecification,
          text,
          sourceSectionCitation: sectionCitation,
          sourceSectionTitle: sectionTitle,
          sourceVersionDate: SOURCE_VERSION_DATE,
        });
        continue;
      }

      const genericTitledMatch = rawParagraph.match(
        /^((?:\([^)]+\))+)\s*<I>([^<]+?)\.<\/I>\s*([\s\S]*)$/i,
      );
      if (genericTitledMatch) {
        const groups = getGroups(genericTitledMatch[1]);
        const title = stripTags(genericTitledMatch[2]);
        const text = stripTags(genericTitledMatch[3]);
        const citation = buildCitation(sectionId, groups);
        currentImplementationPrefixGroups = null;
        const alphaGroup = firstAlphaGroup(groups);
        currentSubsectionBaseGroups = alphaGroup ? [alphaGroup] : [];

        pushRecord(records, {
          citation,
          shortId: citation.replace(/^45 CFR /, ''),
          title,
          type: 'subsection',
          parentCitation: sectionCitation,
          implementationSpecification: null,
          text,
          sourceSectionCitation: sectionCitation,
          sourceSectionTitle: sectionTitle,
          sourceVersionDate: SOURCE_VERSION_DATE,
        });
        continue;
      }

      const plainSubsectionMatch = rawParagraph.match(/^((?:\([^)]+\))+)\s*([\s\S]*)$/);
      if (plainSubsectionMatch) {
        const groups = getGroups(plainSubsectionMatch[1]);
        const alphaGroup = firstAlphaGroup(groups);
        if (alphaGroup) {
          currentSubsectionBaseGroups = [alphaGroup];
          currentImplementationPrefixGroups = null;
        }
      }

      const clauseMatch = rawParagraph.match(/^((?:\([^)]+\))+)\s*([\s\S]*)$/);
      if (clauseMatch && currentImplementationPrefixGroups) {
        const itemGroups = getGroups(clauseMatch[1]);
        const text = stripTags(clauseMatch[2]);
        const citation = buildCitation(sectionId, [
          ...currentImplementationPrefixGroups,
          ...itemGroups,
        ]);

        pushRecord(records, {
          citation,
          shortId: citation.replace(/^45 CFR /, ''),
          title: `Clause ${itemGroups.join('')}`,
          type: 'clause',
          parentCitation:
            currentStandardCitation ??
            buildCitation(sectionId, currentImplementationPrefixGroups) ??
            sectionCitation,
          implementationSpecification: null,
          text,
          sourceSectionCitation: sectionCitation,
          sourceSectionTitle: sectionTitle,
          sourceVersionDate: SOURCE_VERSION_DATE,
        });
      }
    }
  }

  const dedupedRecords = dedupeRecords(records).sort((left, right) =>
    left.citation.localeCompare(right.citation, undefined, { numeric: true }),
  );

  const output = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceAuthority: '45 CFR Part 164 Subpart C',
    sourceUrl: SOURCE_URL,
    sourceVersionDate: SOURCE_VERSION_DATE,
    note: 'Generated from official eCFR XML. Text fields are extracted from the regulation text and are intended for internal control mapping workflows.',
    citations: dedupedRecords,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.info(
    JSON.stringify(
      {
        outputPath: path.relative(process.cwd(), OUTPUT_PATH),
        citationCount: dedupedRecords.length,
        sections: new Set(dedupedRecords.map((record) => sectionFromCitation(record.citation)))
          .size,
      },
      null,
      2,
    ),
  );
}

await main();
