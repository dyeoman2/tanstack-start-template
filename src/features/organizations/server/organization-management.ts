import { api, internal } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { callBetterAuthEndpoint as callBetterAuthEndpointBase } from '~/lib/server/better-auth/http';
import { createConvexAdminClient } from '~/lib/server/convex-admin.server';
import { handleServerError, ServerError } from '~/lib/server/error-utils.server';

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

type OrganizationWriteAction =
  | 'invite'
  | 'update-member-role'
  | 'remove-member'
  | 'cancel-invitation'
  | 'update-settings'
  | 'delete-organization';

type OrganizationInviteResponse = {
  id: string;
};

type OrganizationMemberResponse = {
  member: {
    id: string;
  };
};

type OrganizationMutationResponse = {
  id?: string;
  name?: string;
};

type OrganizationInvitationResponse = {
  invitation: {
    id: string;
  };
};

async function refreshCurrentUserContext() {
  await convexAuthReactStart.fetchAuthMutation(api.users.ensureCurrentUserContext, {});
}

function normalizeOrganizationAuthErrorMessage(
  code: string | undefined,
  message: string | undefined,
  status: number,
) {
  const normalized = code ?? message;

  switch (normalized) {
    case 'Organization not found':
      return 'Organization not found';
    case 'Member not found':
      return 'Organization member not found';
    case 'Invitation not found':
    case 'INVITATION_NOT_FOUND':
      return 'Invitation not found';
    case 'User is already a member of this organization':
      return 'That user is already a member of this organization';
    case 'User is already invited to this organization':
      return 'That user already has a pending invitation';
    case 'You are not allowed to invite users to this organization':
      return 'Organization admin access required';
    case 'You are not allowed to invite user with this role':
      return 'You cannot assign that organization role';
    case 'You are not allowed to cancel this invitation':
      return 'Not authorized to revoke this invitation';
    case 'You are not allowed to delete this member':
      return 'Not authorized to remove this member';
    case 'You are not allowed to update this member':
      return 'Not authorized to change this member role';
    case 'You cannot leave the organization without an owner':
    case 'You cannot leave the organization as the only owner':
      return 'At least one organization owner must remain';
    case 'User is not a member of the organization':
    case 'You are not a member of this organization':
      return 'You are not a member of this organization';
    case 'You are not allowed to update this organization':
      return 'Organization admin access required';
    case 'You are not allowed to delete this organization':
      return 'Organization admin access required';
    default:
      if (status === 404) {
        return 'Organization not found';
      }

      return message || 'Organization action failed';
  }
}

async function callBetterAuthEndpoint<TResponse>(
  path: string,
  init: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
  } = {},
): Promise<TResponse> {
  return await callBetterAuthEndpointBase<TResponse>(path, init, {
    mapErrorMessage: ({ code, message, status }) =>
      normalizeOrganizationAuthErrorMessage(code, message, status),
  });
}

async function requireOrganizationWriteAccess(input: {
  action: OrganizationWriteAction;
  organizationId: string;
  membershipId?: string;
  nextRole?: 'owner' | 'admin' | 'member';
}) {
  const result = await convexAuthReactStart.fetchAuthQuery(
    api.organizationManagement.getOrganizationWriteAccess,
    input,
  );

  if (!result.allowed) {
    throw new Error(result.reason ?? 'Organization action not allowed');
  }
}

export const createOrganizationInvitationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationInvitationSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'invite',
        organizationId: data.organizationId,
      });

      return await callBetterAuthEndpoint<OrganizationInviteResponse>(
        '/api/auth/organization/invite-member',
        {
          method: 'POST',
          body: {
            organizationId: data.organizationId,
            email: data.email.trim().toLowerCase(),
            role: data.role,
            ...(data.resend === true ? { resend: true } : {}),
          },
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
      await requireOrganizationWriteAccess({
        action: 'update-member-role',
        organizationId: data.organizationId,
        membershipId: data.membershipId,
        nextRole: data.role,
      });

      return await callBetterAuthEndpoint<OrganizationMemberResponse>(
        '/api/auth/organization/update-member-role',
        {
          method: 'POST',
          body: {
            organizationId: data.organizationId,
            memberId: data.membershipId,
            role: data.role,
          },
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
      await requireOrganizationWriteAccess({
        action: 'remove-member',
        organizationId: data.organizationId,
        membershipId: data.membershipId,
      });

      const response = await callBetterAuthEndpoint<OrganizationMemberResponse>(
        '/api/auth/organization/remove-member',
        {
          method: 'POST',
          body: {
            organizationId: data.organizationId,
            memberIdOrEmail: data.membershipId,
          },
        },
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
      await requireOrganizationWriteAccess({
        action: 'cancel-invitation',
        organizationId: data.organizationId,
      });

      return await callBetterAuthEndpoint<OrganizationInvitationResponse>(
        '/api/auth/organization/cancel-invitation',
        {
          method: 'POST',
          body: {
            invitationId: data.invitationId,
          },
        },
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
      await requireOrganizationWriteAccess({
        action: 'update-settings',
        organizationId: data.organizationId,
      });

      return await callBetterAuthEndpoint<OrganizationMutationResponse>(
        '/api/auth/organization/update',
        {
          method: 'POST',
          body: {
            organizationId: data.organizationId,
            data: {
              name: data.name.trim(),
              logo: data.logo?.trim() || undefined,
            },
          },
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
      await requireOrganizationWriteAccess({
        action: 'delete-organization',
        organizationId: data.organizationId,
      });

      const response = await callBetterAuthEndpoint<OrganizationMutationResponse>(
        '/api/auth/organization/delete',
        {
          method: 'POST',
          body: data,
        },
      );

      try {
        await createConvexAdminClient().action(
          internal.organizationManagement.cleanupOrganizationDataInternal,
          {
            organizationId: data.organizationId,
          },
        );
      } catch (error) {
        throw new ServerError(
          'Organization removal succeeded, but app cleanup failed. Retry the cleanup flow to reconcile remaining organization data.',
          error instanceof ServerError ? error.code : 500,
          error,
        );
      }

      await refreshCurrentUserContext();
      return response;
    } catch (error) {
      throw handleServerError(error, 'Delete organization');
    }
  });
