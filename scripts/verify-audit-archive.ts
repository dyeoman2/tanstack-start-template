#!/usr/bin/env npx tsx
/**
 * Offline Audit Archive Integrity Verification Tool
 *
 * Verifies the cryptographic hash chain of an exported JSONL audit archive
 * without requiring database or production access. Designed for third-party
 * auditors and incident responders.
 *
 * Usage:
 *   npx tsx scripts/verify-audit-archive.ts <path-to-jsonl-or-jsonl.gz> [--manifest <manifest.json>]
 *
 * The tool:
 *   1. Reads and decompresses the JSONL payload (supports .gz and plain .jsonl)
 *   2. Parses each line as a JSON audit event
 *   3. Recomputes the SHA-256 hash chain for every event
 *   4. Validates sequence monotonicity, previousEventHash linkage, and eventHash integrity
 *   5. Optionally validates the manifest headHash and rowCount
 *   6. Reports any tamper conditions found
 */

import { createReadStream, readFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

type AuditEvent = {
  chainId: string;
  id: string;
  sequence: number;
  eventType: string;
  recordedAt: number;
  provenance: {
    kind: string;
    emitter: string;
    actorUserId?: string;
    sessionId?: string;
    identifier?: string;
    initiatedByUserId?: string;
    scimProviderId?: string;
  };
  userId?: string;
  actorUserId?: string;
  targetUserId?: string;
  organizationId?: string;
  identifier?: string;
  sessionId?: string;
  requestId?: string;
  outcome?: string;
  severity?: string;
  resourceType?: string;
  resourceId?: string;
  resourceLabel?: string;
  sourceSurface?: string;
  metadata?: string;
  ipAddress?: string;
  userAgent?: string;
  eventHash?: string;
  previousEventHash?: string | null;
};

type Manifest = {
  chainId: string;
  chainVersion: number;
  firstSequence: number | null;
  lastSequence: number | null;
  rowCount: number;
  headHash: string | null;
  exportedAt: number;
};

type VerificationFailure = {
  eventId: string;
  sequence: number;
  reason: string;
  expected: string | null;
  actual: string | null;
};

function buildAuditHashPayload(event: AuditEvent): string {
  return JSON.stringify({
    chainId: event.chainId,
    id: event.id,
    sequence: event.sequence,
    eventType: event.eventType,
    recordedAt: event.recordedAt,
    provenance: event.provenance,
    userId: event.userId ?? null,
    actorUserId: event.actorUserId ?? null,
    targetUserId: event.targetUserId ?? null,
    organizationId: event.organizationId ?? null,
    identifier: event.identifier ?? null,
    sessionId: event.sessionId ?? null,
    requestId: event.requestId ?? null,
    outcome: event.outcome ?? null,
    severity: event.severity ?? null,
    resourceType: event.resourceType ?? null,
    resourceId: event.resourceId ?? null,
    resourceLabel: event.resourceLabel ?? null,
    sourceSurface: event.sourceSurface ?? null,
    metadata: event.metadata ?? null,
    ipAddress: event.ipAddress ?? null,
    userAgent: event.userAgent ?? null,
    previousEventHash: event.previousEventHash ?? null,
  });
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf-8').digest('hex');
}

async function readJsonlFile(filePath: string): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [];
  const isGzip = filePath.endsWith('.gz');

  const input = createReadStream(filePath);
  const source = isGzip ? input.pipe(createGunzip()) : input;

  const lines: string[] = [];
  const lineCollector = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) {
          lines.push(line.trim());
        }
      }
      callback();
    },
  });

  await pipeline(source, lineCollector);

  for (const line of lines) {
    events.push(JSON.parse(line) as AuditEvent);
  }

  return events;
}

function verifyChain(events: AuditEvent[]): {
  failures: VerificationFailure[];
  verifiedCount: number;
  headHash: string | null;
} {
  const failures: VerificationFailure[] = [];
  let previousHash: string | null = null;
  let lastSequence: number | null = null;

  for (const event of events) {
    // Check sequence monotonicity
    if (lastSequence !== null && event.sequence <= lastSequence) {
      failures.push({
        eventId: event.id,
        sequence: event.sequence,
        reason: 'sequence_not_monotonic',
        expected: `> ${lastSequence}`,
        actual: String(event.sequence),
      });
    }

    // Check previousEventHash linkage
    const eventPreviousHash = event.previousEventHash ?? null;
    if (eventPreviousHash !== previousHash) {
      failures.push({
        eventId: event.id,
        sequence: event.sequence,
        reason: 'previous_hash_mismatch',
        expected: previousHash,
        actual: eventPreviousHash,
      });
    }

    // Recompute and verify eventHash
    const recomputedHash = sha256Hex(buildAuditHashPayload(event));
    if (event.eventHash && event.eventHash !== recomputedHash) {
      failures.push({
        eventId: event.id,
        sequence: event.sequence,
        reason: 'event_hash_mismatch',
        expected: recomputedHash,
        actual: event.eventHash,
      });
    }

    previousHash = event.eventHash ?? recomputedHash;
    lastSequence = event.sequence;
  }

  return {
    failures,
    verifiedCount: events.length,
    headHash: previousHash,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'Usage: npx tsx scripts/verify-audit-archive.ts <path-to-jsonl-or-jsonl.gz> [--manifest <manifest.json>]',
    );
    process.exit(1);
  }

  const payloadPath = args[0];
  const manifestIndex = args.indexOf('--manifest');
  const manifestPath = manifestIndex !== -1 ? args[manifestIndex + 1] : undefined;

  console.log(`Reading audit archive: ${payloadPath}`);
  const events = await readJsonlFile(payloadPath);
  console.log(`Parsed ${events.length} audit events`);

  if (events.length === 0) {
    console.log('No events to verify.');
    process.exit(0);
  }

  // Sort by sequence to ensure correct order
  events.sort((a, b) => a.sequence - b.sequence);

  console.log(`Sequence range: ${events[0].sequence} - ${events[events.length - 1].sequence}`);
  console.log('Verifying hash chain...');

  const result = verifyChain(events);

  if (manifestPath) {
    console.log(`\nValidating manifest: ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;

    if (manifest.rowCount !== events.length) {
      result.failures.push({
        eventId: 'manifest',
        sequence: -1,
        reason: 'manifest_row_count_mismatch',
        expected: String(manifest.rowCount),
        actual: String(events.length),
      });
    }

    if (manifest.headHash && manifest.headHash !== result.headHash) {
      result.failures.push({
        eventId: 'manifest',
        sequence: -1,
        reason: 'manifest_head_hash_mismatch',
        expected: manifest.headHash,
        actual: result.headHash,
      });
    }

    if (manifest.firstSequence !== null && manifest.firstSequence !== events[0].sequence) {
      result.failures.push({
        eventId: 'manifest',
        sequence: -1,
        reason: 'manifest_first_sequence_mismatch',
        expected: String(manifest.firstSequence),
        actual: String(events[0].sequence),
      });
    }

    if (
      manifest.lastSequence !== null &&
      manifest.lastSequence !== events[events.length - 1].sequence
    ) {
      result.failures.push({
        eventId: 'manifest',
        sequence: -1,
        reason: 'manifest_last_sequence_mismatch',
        expected: String(manifest.lastSequence),
        actual: String(events[events.length - 1].sequence),
      });
    }
  }

  console.log(`\nVerified ${result.verifiedCount} events`);
  console.log(`Head hash: ${result.headHash}`);

  if (result.failures.length === 0) {
    console.log('\nRESULT: PASS - All events verified, hash chain intact.');
    process.exit(0);
  } else {
    console.error(`\nRESULT: FAIL - ${result.failures.length} integrity violation(s) detected:\n`);
    for (const failure of result.failures) {
      console.error(
        `  [${failure.reason}] event=${failure.eventId} seq=${failure.sequence}` +
          `\n    expected: ${failure.expected}` +
          `\n    actual:   ${failure.actual}`,
      );
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(2);
});
