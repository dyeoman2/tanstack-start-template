import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSecretTierAcknowledgment,
  hasSecretTierAcknowledgment,
  validateSecretTierDocumentation,
} from './secret-tier';

describe('secret-tier helpers', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('accepts explicit acknowledgment by flag or environment', () => {
    expect(hasSecretTierAcknowledgment(['node', '--ack-secret-tier'], {})).toBe(true);
    expect(hasSecretTierAcknowledgment(['node'], { CONVEX_SECRET_TIER_ACK: '1' })).toBe(true);
    expect(hasSecretTierAcknowledgment(['node'], {})).toBe(false);
  });

  it('throws when secret-tier acknowledgment is missing', () => {
    expect(() =>
      assertSecretTierAcknowledgment({
        command: 'pnpm run setup:prod --',
        argv: ['node'],
        env: {},
      }),
    ).toThrow('secret-tier production access');
  });

  it('validates required secret-tier documentation markers', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'secret-tier-docs-'));
    tempDirs.push(tempDir);
    mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    writeFileSync(
      path.join(tempDir, 'docs', 'AUTH_SECURITY.md'),
      'secret-tier production access\nactive session rows as bearer-equivalent\n',
      'utf8',
    );
    writeFileSync(
      path.join(tempDir, 'docs', 'DEPLOY_ENVIRONMENT.md'),
      'CONVEX_SECRET_TIER_ACK=1\n--ack-secret-tier\ndocs/CONVEX_SECRET_TIER_ACCESS.md\n',
      'utf8',
    );
    writeFileSync(
      path.join(tempDir, 'docs', 'CONVEX_SECRET_TIER_ACCESS.md'),
      'Quarterly access review\nSession purge\nCONVEX_DEPLOY_KEY\n',
      'utf8',
    );

    expect(validateSecretTierDocumentation(tempDir).ok).toBe(true);
  });
});
