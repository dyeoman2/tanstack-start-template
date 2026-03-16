import { expectTypeOf, it } from 'vitest';
import { authClient, authHooks } from './auth-client';

it('exposes the supported auth client surface', () => {
  expectTypeOf(authClient.admin.impersonateUser).toBeFunction();
  expectTypeOf(authClient.changeEmail).toBeFunction();
  expectTypeOf(authClient.changePassword).toBeFunction();
  expectTypeOf(authClient.getSession).toBeFunction();
  expectTypeOf(authClient.requestPasswordReset).toBeFunction();
  expectTypeOf(authClient.resetPassword).toBeFunction();
  expectTypeOf(authClient.sendVerificationEmail).toBeFunction();
  expectTypeOf(authClient.signUp.email).toBeFunction();
  expectTypeOf(authClient.organization.acceptInvitation).toBeFunction();
  expectTypeOf(authClient.organization.listUserInvitations).toBeFunction();
  expectTypeOf(authClient.passkey.addPasskey).toBeFunction();
  expectTypeOf(authClient.twoFactor.verifyBackupCode).toBeFunction();
});

it('exposes the supported auth hook surface', () => {
  expectTypeOf(authHooks.useActiveOrganization).toBeFunction();
  expectTypeOf(authHooks.useAuthQuery).toBeFunction();
  expectTypeOf(authHooks.useInvitation).toBeFunction();
  expectTypeOf(authHooks.useListAccounts).toBeFunction();
  expectTypeOf(authHooks.useListOrganizations).toBeFunction();
  expectTypeOf(authHooks.useListPasskeys).toBeFunction();
});
