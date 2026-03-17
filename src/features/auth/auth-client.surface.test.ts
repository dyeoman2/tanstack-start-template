import { expectTypeOf, it } from 'vitest';
import { authClient, authHooks } from './auth-client';

it('exposes the supported auth client surface', () => {
  expectTypeOf(authClient.admin.impersonateUser).toBeFunction();
  expectTypeOf(authClient.admin.stopImpersonating).toBeFunction();
  expectTypeOf(authClient.changeEmail).toBeFunction();
  expectTypeOf(authClient.changePassword).toBeFunction();
  expectTypeOf(authClient.listAccounts).toBeFunction();
  expectTypeOf(authClient.getSession).toBeFunction();
  expectTypeOf(authClient.requestPasswordReset).toBeFunction();
  expectTypeOf(authClient.resetPassword).toBeFunction();
  expectTypeOf(authClient.sendVerificationEmail).toBeFunction();
  expectTypeOf(authClient.signIn.email).toBeFunction();
  expectTypeOf(authClient.signIn.passkey).toBeFunction();
  expectTypeOf(authClient.signIn.social).toBeFunction();
  expectTypeOf(authClient.signUp.email).toBeFunction();
  expectTypeOf(authClient.organization.acceptInvitation).toBeFunction();
  expectTypeOf(authClient.organization.getFullOrganization).toBeFunction();
  expectTypeOf(authClient.organization.getInvitation).toBeFunction();
  expectTypeOf(authClient.organization.list).toBeFunction();
  expectTypeOf(authClient.organization.listUserInvitations).toBeFunction();
  expectTypeOf(authClient.organization.rejectInvitation).toBeFunction();
  expectTypeOf(authClient.organization.setActive).toBeFunction();
  expectTypeOf(authClient.passkey.addPasskey).toBeFunction();
  expectTypeOf(authClient.passkey.deletePasskey).toBeFunction();
  expectTypeOf(authClient.passkey.listUserPasskeys).toBeFunction();
  expectTypeOf(authClient.twoFactor.disable).toBeFunction();
  expectTypeOf(authClient.twoFactor.enable).toBeFunction();
  expectTypeOf(authClient.twoFactor.verifyBackupCode).toBeFunction();
  expectTypeOf(authClient.twoFactor.verifyTotp).toBeFunction();
  expectTypeOf(authClient.updateUser).toBeFunction();
});

it('exposes the supported auth hook surface', () => {
  expectTypeOf(authHooks.useActiveOrganization).toBeFunction();
  expectTypeOf(authHooks.useAuthQuery).toBeFunction();
  expectTypeOf(authHooks.useInvitation).toBeFunction();
  expectTypeOf(authHooks.useListAccounts).toBeFunction();
  expectTypeOf(authHooks.useListOrganizations).toBeFunction();
  expectTypeOf(authHooks.useListPasskeys).toBeFunction();
});
