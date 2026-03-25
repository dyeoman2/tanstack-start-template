import { describe, expect, it } from 'vitest';
import { validateSecurityEvidenceUploadInput } from './validators';

describe('validateSecurityEvidenceUploadInput', () => {
  it('accepts csv evidence uploads', () => {
    expect(() =>
      validateSecurityEvidenceUploadInput({
        contentType: 'text/csv',
        fileName: 'controls.csv',
        fileSize: 1024,
      }),
    ).not.toThrow();
  });

  it('rejects xlsx evidence uploads', () => {
    expect(() =>
      validateSecurityEvidenceUploadInput({
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'controls.xlsx',
        fileSize: 1024,
      }),
    ).toThrow('Evidence file type is not allowed for this workflow.');
  });
});
