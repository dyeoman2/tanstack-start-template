import { describe, expect, it } from 'vitest';
import {
  buildMirrorStorageKey,
  buildPromotedStorageKey,
  buildQuarantineStorageKey,
  buildRejectedStorageKey,
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

  it('builds dedicated mirror keys under the mirror prefix', () => {
    expect(
      buildMirrorStorageKey({
        organizationId: 'org_123',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
      }),
    ).toBe('mirror/org/org_123/chat_attachment/file_1');
  });

  it('builds rejected keys under the rejected prefix', () => {
    expect(
      buildRejectedStorageKey({
        organizationId: 'org_123',
        sourceType: 'chat_attachment',
        storageId: 'file_1',
      }),
    ).toBe('rejected/org/org_123/chat_attachment/file_1');
  });
});
