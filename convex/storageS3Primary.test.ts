import { describe, expect, it } from 'vitest';
import {
  buildDeterministicStorageKey,
  buildPromotedStorageKey,
  buildQuarantineStorageKey,
} from './storageS3Primary';

describe('s3-primary key builders', () => {
  it('builds quarantine keys under the quarantine prefix', () => {
    expect(
      buildQuarantineStorageKey({
        organizationId: 'org_123',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
      }),
    ).toBe('quarantine/org/org_123/chat_attachment/file_1');
  });

  it('builds promoted keys under the clean prefix', () => {
    expect(
      buildPromotedStorageKey({
        organizationId: 'org_123',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
      }),
    ).toBe('clean/org/org_123/chat_attachment/file_1');
  });

  it('keeps the legacy deterministic key shape for non-migrated paths', () => {
    expect(
      buildDeterministicStorageKey({
        organizationId: 'org_123',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
      }),
    ).toBe('org/org_123/chat_attachment/file_1');
  });
});
