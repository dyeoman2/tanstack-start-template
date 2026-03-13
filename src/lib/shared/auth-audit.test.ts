import { describe, expect, it } from 'vitest';
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_AUDIT_EVENT_OWNERS,
  AUTH_AUDIT_HANDLER_OWNERS,
  isAuthAuditHandlerOwner,
  isAuthAuditEventType,
  normalizeAuditIdentifier,
} from './auth-audit';

describe('auth audit helpers', () => {
  it('recognizes supported audit event types', () => {
    expect(isAuthAuditEventType('user_signed_up')).toBe(true);
    expect(isAuthAuditEventType('not_a_real_event')).toBe(false);
  });

  it('normalizes identifiers for stable filtering', () => {
    expect(normalizeAuditIdentifier('  Example@Domain.com ')).toBe('example@domain.com');
    expect(normalizeAuditIdentifier('')).toBeUndefined();
    expect(normalizeAuditIdentifier(undefined)).toBeUndefined();
  });

  it('includes organization and team events in the supported list', () => {
    expect(AUTH_AUDIT_EVENT_TYPES).toContain('member_invited');
    expect(AUTH_AUDIT_EVENT_TYPES).toContain('team_member_removed');
  });

  it('maps every supported event to at least one handler owner', () => {
    expect(Object.keys(AUTH_AUDIT_EVENT_OWNERS).sort()).toEqual([...AUTH_AUDIT_EVENT_TYPES].sort());

    for (const eventType of AUTH_AUDIT_EVENT_TYPES) {
      expect(AUTH_AUDIT_EVENT_OWNERS[eventType].length).toBeGreaterThan(0);
    }
  });

  it('only uses valid handler owners in the coverage registry', () => {
    expect([...AUTH_AUDIT_HANDLER_OWNERS]).toEqual(
      AUTH_AUDIT_HANDLER_OWNERS.filter((owner) => isAuthAuditHandlerOwner(owner)),
    );

    for (const owners of Object.values(AUTH_AUDIT_EVENT_OWNERS)) {
      for (const owner of owners) {
        expect(isAuthAuditHandlerOwner(owner)).toBe(true);
      }
    }
  });
});
