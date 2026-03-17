import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const authSource = readFileSync(resolve(import.meta.dirname, './auth.ts'), 'utf8');

describe('Better Auth boundary guardrails', () => {
  it('keeps auth.ts focused on composition by delegating email callbacks', () => {
    expect(authSource).toContain('betterAuthEmailServices');
    expect(authSource).toContain('createSendInvitationEmailHandler');
    expect(authSource).toContain('createSendResetPasswordHandler');
    expect(authSource).toContain('createSendChangeEmailConfirmationHandler');
    expect(authSource).toContain('createSendVerificationEmailHandler');

    expect(authSource).not.toContain('sendInvitationEmail: async');
    expect(authSource).not.toContain('sendResetPassword: async');
    expect(authSource).not.toContain('sendChangeEmailConfirmation: async');
    expect(authSource).not.toContain('sendVerificationEmail: async');
    expect(authSource).not.toContain('function createSendInvitationEmailHandler(');
    expect(authSource).not.toContain('function logSkippedE2EAuthEmail(');
    expect(authSource).not.toContain('export function resolveAuthEmailUrl(');
  });

  it('keeps auth.ts focused on wiring by delegating policy decisions', () => {
    expect(authSource).toContain("from './betterAuth/policyServices'");
    expect(authSource).toContain('canUserSelfServeCreateOrganization');
    expect(authSource).toContain('assertScimManagementAccess');
    expect(authSource).toContain('getPasswordAuthBlockMessage');
    expect(authSource).toContain('resolveEnterpriseSessionContext');
    expect(authSource).toContain('resolveInitialActiveOrganizationId');

    expect(authSource).not.toContain('function shouldSkipE2EAuthEmailForTesting(');
    expect(authSource).not.toContain('async function isSiteAdminUser(');
    expect(authSource).not.toContain('async function isOrganizationOwner(');
    expect(authSource).not.toContain('async function verifyGoogleHostedDomain(');
    expect(authSource).not.toContain('async function ensureEnterpriseOrganizationMembership(');
  });
});
