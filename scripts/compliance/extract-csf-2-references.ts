import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type InformativeReference = {
  framework: string;
  frameworkVersionIdentifier?: string;
  olirName?: string;
  relationIdentifier?: string;
  reference: string;
  referenceTitle?: string;
  referenceType?: string;
};

type CsfSubcategory = {
  categoryId: string;
  categoryTitle: string;
  functionId: string;
  functionTitle: string;
  implementationExamples: string[];
  informativeReferences: InformativeReference[];
  subcategoryId: string;
  subcategoryTitle: string;
};

const SOURCE_PATH = path.resolve(
  process.cwd(),
  'compliance/sources/nist/csf-2.0/csf-2.0-elements.json',
);
const OUTPUT_PATH = path.resolve(
  process.cwd(),
  'compliance/generated/csf-2.0-informative-references.json',
);

type CsfRelationship = {
  elementIdentifier: string;
  elementTypeIdentifier: string;
  frameworkVersionIdentifier?: string;
  olirName?: string;
  relationIdentifier: string;
  shortName: string;
  text: string;
  title: string;
};

type CsfImplementationExample = {
  elementIdentifier: string;
  elementTypeIdentifier: string;
  text: string;
  title: string;
};

type CsfSubcategoryNode = {
  elementIdentifier: string;
  text: string;
  title: string;
  elements?: CsfImplementationExample[];
  externalRelationships?: CsfRelationship[];
};

type CsfCategoryNode = {
  elementIdentifier: string;
  text: string;
  title: string;
  elements?: CsfSubcategoryNode[];
};

type CsfFunctionNode = {
  elementIdentifier: string;
  text: string;
  title: string;
  elements?: CsfCategoryNode[];
};

type CsfElementsPayload = {
  response: {
    elements: CsfFunctionNode[];
  };
};

function parseImplementationExamples(elements: CsfImplementationExample[] | undefined): string[] {
  return (elements ?? [])
    .filter((element) => element.elementTypeIdentifier === 'implementation_example')
    .map((element) => element.text.trim())
    .filter((item) => item.length > 0);
}

function parseInformativeReferences(
  relationships: CsfRelationship[] | undefined,
): InformativeReference[] {
  return (relationships ?? [])
    .filter((relationship) => relationship.shortName.trim().length > 0)
    .map((relationship) => ({
      framework: relationship.shortName.trim(),
      frameworkVersionIdentifier: relationship.frameworkVersionIdentifier,
      olirName: relationship.olirName,
      relationIdentifier: relationship.relationIdentifier,
      reference: relationship.elementIdentifier.trim(),
      referenceTitle: relationship.title.trim() || undefined,
      referenceType: relationship.elementTypeIdentifier.trim() || undefined,
    }));
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

async function main() {
  const raw = await readFile(SOURCE_PATH, 'utf8');
  const payload = JSON.parse(raw) as CsfElementsPayload;
  const subcategories: CsfSubcategory[] = [];

  for (const functionNode of payload.response.elements) {
    for (const categoryNode of functionNode.elements ?? []) {
      for (const subcategoryNode of categoryNode.elements ?? []) {
        if (
          !subcategoryNode.elementIdentifier.includes('-') ||
          subcategoryNode.elementIdentifier.startsWith('WR-')
        ) {
          continue;
        }

        subcategories.push({
          functionId: functionNode.elementIdentifier,
          functionTitle: functionNode.title.trim(),
          categoryId: categoryNode.elementIdentifier,
          categoryTitle: categoryNode.title.trim(),
          subcategoryId: subcategoryNode.elementIdentifier,
          subcategoryTitle: subcategoryNode.text.trim(),
          implementationExamples: parseImplementationExamples(subcategoryNode.elements),
          informativeReferences: parseInformativeReferences(
            subcategoryNode.externalRelationships,
          ),
        });
      }
    }
  }

  const families = Array.from(new Set(subcategories.map((subcategory) => subcategory.functionId)));
  const categories = Array.from(
    new Set(subcategories.map((subcategory) => subcategory.categoryId)),
  );

  const nist80053Index = Object.fromEntries(
    Object.entries(
      subcategories.reduce<Record<string, CsfSubcategory[]>>((accumulator, subcategory) => {
        for (const reference of subcategory.informativeReferences) {
          if (!reference.framework.startsWith('SP 800-53 Rev 5')) {
            continue;
          }

          const normalizedId = normalizeNistControlId(reference.reference);
          if (!normalizedId) {
            continue;
          }

          const existing = accumulator[normalizedId] ?? [];
          if (!existing.some((item) => item.subcategoryId === subcategory.subcategoryId)) {
            existing.push(subcategory);
          }
          accumulator[normalizedId] = existing;
        }

        return accumulator;
      }, {}),
    ).map(([controlId, items]) => [
      controlId,
      items.map((item) => ({
        categoryId: item.categoryId,
        categoryTitle: item.categoryTitle,
        functionId: item.functionId,
        functionTitle: item.functionTitle,
        subcategoryId: item.subcategoryId,
        subcategoryTitle: item.subcategoryTitle,
      })),
    ]),
  );

  const normalizedPayload = {
    generatedAt: new Date().toISOString(),
    sourcePath: path.relative(process.cwd(), SOURCE_PATH),
    functionCount: families.length,
    categoryCount: categories.length,
    subcategoryCount: subcategories.length,
    subcategories,
    indexes: {
      nist80053: nist80053Index,
    },
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(normalizedPayload, null, 2)}\n`, 'utf8');

  console.log(
    `Extracted ${subcategories.length} CSF 2.0 subcategories across ${families.length} functions.`,
  );
}

await main();
