import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateStorageIamReport } from '../../scripts/generate-storage-iam-report';

describe('storage IAM report', () => {
  it('matches the checked-in synthesized IAM report', () => {
    const checkedInReport = readFileSync(
      path.join(process.cwd(), 'docs', 'generated', 'storage-iam-report.md'),
      'utf8',
    );

    expect(generateStorageIamReport({ stage: 'dev' })).toBe(checkedInReport);
  });
});
