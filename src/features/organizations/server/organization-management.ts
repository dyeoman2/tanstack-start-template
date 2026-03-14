import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { handleServerError } from '~/lib/server/error-utils.server';

const organizationInvitationSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
  resend: z.boolean().optional(),
});

const organizationMemberRoleSchema = z.object({
  organizationId: z.string().min(1),
  membershipId: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member']),
});

const organizationMemberRemovalSchema = z.object({
  organizationId: z.string().min(1),
  membershipId: z.string().min(1),
});

const organizationInvitationCancelSchema = z.object({
  organizationId: z.string().min(1),
  invitationId: z.string().min(1),
});

const organizationSettingsSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  logo: z.string().nullable(),
});

const organizationDeleteSchema = z.object({
  organizationId: z.string().min(1),
});

async function refreshCurrentUserContext() {
  await convexAuthReactStart.fetchAuthMutation(api.users.ensureCurrentUserContext, {});
}

export const createOrganizationInvitationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationInvitationSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.createOrganizationInvitation,
        {
          organizationId: data.organizationId,
          email: data.email.trim().toLowerCase(),
          role: data.role,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Create organization invitation');
    }
  });

export const updateOrganizationMemberRoleServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationMemberRoleSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.updateOrganizationMemberRole,
        {
          organizationId: data.organizationId,
          membershipId: data.membershipId,
          role: data.role,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Update organization member role');
    }
  });

export const removeOrganizationMemberServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationMemberRemovalSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      const response = await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.removeOrganizationMember,
        data,
      );
      await refreshCurrentUserContext();
      return response;
    } catch (error) {
      throw handleServerError(error, 'Remove organization member');
    }
  });

export const cancelOrganizationInvitationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationInvitationCancelSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.cancelOrganizationInvitation,
        data,
      );
    } catch (error) {
      throw handleServerError(error, 'Cancel organization invitation');
    }
  });

export const updateOrganizationSettingsServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationSettingsSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.updateOrganizationSettings,
        {
          organizationId: data.organizationId,
          name: data.name.trim(),
          logo: data.logo?.trim() || null,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Update organization settings');
    }
  });

export const deleteOrganizationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationDeleteSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      const response = await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.deleteOrganization,
        data,
      );
      await refreshCurrentUserContext();
      return response;
    } catch (error) {
      throw handleServerError(error, 'Delete organization');
    }
  });
