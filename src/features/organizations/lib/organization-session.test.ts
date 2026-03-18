import { describe, expect, it } from 'vitest';
import { getServerFunctionErrorMessage } from './organization-session';

describe('getServerFunctionErrorMessage', () => {
  it('returns a friendly message for unsupported audit event failures', () => {
    const error = new Error(
      '[Request ID: abc123] Server Error Uncaught Error: Uncaught Error: Unsupported audit event type: enterprise_auth_mode_updated at handler (../convex/audit.ts:154:4)',
    );

    expect(
      getServerFunctionErrorMessage(error, 'Failed to update SSO enforcement. Try again.'),
    ).toBe('We ran into an internal problem while saving this change. Try again in a moment.');
  });

  it('falls back for raw server wrapper errors', () => {
    const error = new Error(
      '[Request ID: abc123] Server Error something noisy at handler (../convex/file.ts:1:1)',
    );

    expect(
      getServerFunctionErrorMessage(error, 'Failed to update SSO enforcement. Try again.'),
    ).toBe('Failed to update SSO enforcement. Try again.');
  });
});
