import { api } from '@convex/_generated/api';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireAuth } from '~/features/auth/server/auth-guards';
import { convexAuthReactStart } from '~/features/auth/server/convex-better-auth-react-start';
import { getBetterAuthRequest } from '~/lib/server/better-auth/http';
import { resolveRequestAuditContext } from '~/lib/server/request-audit-context';
import { normalizeOrganizationSlug } from '~/features/organizations/lib/organization-slug';
import {
  organizationAuditSearchSchema,
  organizationDirectorySearchSchema,
} from '~/features/organizations/lib/organization-management';
import {
  cancelBetterAuthOrganizationInvitation,
  checkBetterAuthOrganizationSlug,
  createBetterAuthOrganization,
  createBetterAuthOrganizationInvitation,
  deleteBetterAuthOrganization,
  deleteBetterAuthOrganizationScimProvider,
  generateBetterAuthOrganizationScimToken,
  removeBetterAuthOrganizationMember,
  updateBetterAuthOrganization,
  updateBetterAuthOrganizationMemberRole,
} from '~/lib/server/better-auth/api';
import { handleServerError, ServerError } from '~/lib/server/error-utils.server';
import { REGULATED_ORGANIZATION_POLICY_DEFAULTS } from '~/lib/shared/security-baseline';

const organizationInvitationSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']),
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

const organizationMemberStateSchema = z.object({
  organizationId: z.string().min(1),
  membershipId: z.string().min(1),
  reason: z.string().trim().nullable().optional(),
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

const organizationPoliciesSchema = z.object({
  organizationId: z.string().min(1),
  invitePolicy: z.enum(['owners_admins', 'owners_only']),
  verifiedDomainsOnly: z.boolean(),
  memberCap: z.number().int().positive().nullable(),
  mfaRequired: z.boolean().default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.mfaRequired),
  auditExportRequiresStepUp: z
    .boolean()
    .default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.auditExportRequiresStepUp),
  attachmentSharingAllowed: z
    .boolean()
    .default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.attachmentSharingAllowed),
  dataRetentionDays: z
    .number()
    .int()
    .positive()
    .default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.dataRetentionDays),
  enterpriseAuthMode: z.enum(['off', 'optional', 'required']),
  enterpriseProviderKey: z.enum(['google-workspace', 'entra', 'okta']).nullable(),
  enterpriseProtocol: z.enum(['oidc']).nullable(),
  allowBreakGlassPasswordLogin: z
    .boolean()
    .default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.allowBreakGlassPasswordLogin),
  temporaryLinkTtlMinutes: z
    .number()
    .int()
    .positive()
    .max(15)
    .default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.temporaryLinkTtlMinutes),
  webSearchAllowed: z.boolean().default(REGULATED_ORGANIZATION_POLICY_DEFAULTS.webSearchAllowed),
});

const organizationEnterpriseProviderSchema = z.object({
  organizationId: z.string().min(1),
  providerKey: z.enum(['google-workspace', 'entra', 'okta']),
});

const organizationSupportAccessScopeSchema = z.enum(['read_only', 'read_write']);

const organizationSupportAccessGrantSchema = z.object({
  organizationId: z.string().min(1),
  siteAdminUserId: z.string().min(1),
  scope: organizationSupportAccessScopeSchema,
  ticketId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
  expiresAt: z.number().int().positive(),
});

const organizationSupportAccessGrantRevocationSchema = z.object({
  organizationId: z.string().min(1),
  grantId: z.string().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
});

const organizationLegalHoldApplySchema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
});

const organizationLegalHoldReleaseSchema = z.object({
  organizationId: z.string().min(1),
});

const organizationAuditExportSchema = organizationAuditSearchSchema
  .pick({
    sortBy: true,
    sortOrder: true,
    preset: true,
    eventType: true,
    search: true,
    startDate: true,
    endDate: true,
    failuresOnly: true,
  })
  .extend({
    slug: z.string().min(1),
  });

const organizationDirectoryExportSchema = organizationDirectorySearchSchema
  .pick({
    sortBy: true,
    sortOrder: true,
    secondarySortBy: true,
    secondarySortOrder: true,
    search: true,
    kind: true,
  })
  .extend({
    asOf: z.number().int().positive(),
    slug: z.string().min(1),
  });

const organizationBulkActionSchema = z.object({
  organizationId: z.string().min(1),
  action: z.enum(['revoke-invites', 'resend-invites', 'remove-members']),
  invitations: z
    .array(
      z.object({
        invitationId: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['owner', 'admin', 'member']),
      }),
    )
    .default([]),
  members: z
    .array(
      z.object({
        membershipId: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['owner', 'admin', 'member']),
      }),
    )
    .default([]),
});

const organizationDeleteSchema = z.object({
  organizationId: z.string().min(1),
});

const organizationCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

const organizationSlugSchema = z.object({
  slug: z.string().min(1),
});

type OrganizationWriteAction =
  | 'invite'
  | 'update-member-role'
  | 'remove-member'
  | 'suspend-member'
  | 'deactivate-member'
  | 'reactivate-member'
  | 'cancel-invitation'
  | 'manage-scim'
  | 'update-settings'
  | 'delete-organization';

async function refreshCurrentUserContext() {
  await convexAuthReactStart.fetchAuthAction(api.users.ensureCurrentUserContext, {});
}

async function recordBulkOrganizationAuditEvents(input: {
  organizationId: string;
  eventType: 'bulk_invite_revoked' | 'bulk_invite_resent' | 'bulk_member_removed';
  entries: Array<{
    targetEmail: string;
    targetId: string;
    targetRole?: 'owner' | 'admin' | 'member';
  }>;
}) {
  await convexAuthReactStart.fetchAuthMutation(
    api.organizationManagement.recordOrganizationBulkAuditEvents,
    input,
  );
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

async function requireOrganizationWriteAccess(input: {
  action: OrganizationWriteAction;
  organizationId: string;
  email?: string;
  membershipId?: string;
  nextRole?: 'owner' | 'admin' | 'member';
  resend?: boolean;
}) {
  const result = await convexAuthReactStart.fetchAuthQuery(
    api.organizationManagement.getOrganizationWriteAccess,
    input,
  );

  if (!result.allowed) {
    throw new Error(result.reason ?? 'Organization action not allowed');
  }
}

async function requireOrganizationCreationEligibility() {
  const result = await convexAuthReactStart.fetchAuthQuery(
    api.organizationManagement.getOrganizationCreationEligibility,
    {},
  );

  if (!result.canCreate) {
    throw new Error(result.reason ?? 'Organization creation limit reached');
  }

  return result;
}

function isOrganizationSlugTakenError(error: unknown) {
  return (
    error instanceof ServerError &&
    error.code === 400 &&
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('slug')
  );
}

async function assertOrganizationSlugAvailable(slug: string) {
  try {
    await checkBetterAuthOrganizationSlug(slug, ({ code, message, status }) =>
      normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
    );
  } catch (error) {
    if (isOrganizationSlugTakenError(error)) {
      throw new Error('That organization URL is already in use. Try a different name.');
    }

    throw error;
  }
}

export const checkOrganizationSlugServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationSlugSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const slug = normalizeOrganizationSlug(data.slug);
      await assertOrganizationSlugAvailable(slug);
      return {
        available: true,
        slug,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('already in use')) {
        return {
          available: false,
          slug: normalizeOrganizationSlug(data.slug),
        };
      }

      throw handleServerError(error, 'Check organization slug');
    }
  });

export const createOrganizationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationCreateSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationCreationEligibility();
      const name = data.name.trim();
      const slug = normalizeOrganizationSlug(data.slug);
      await assertOrganizationSlugAvailable(slug);

      const response = await createBetterAuthOrganization(
        {
          keepCurrentActiveOrganization: false,
          name,
          slug,
        },
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
      );

      await refreshCurrentUserContext();
      return response;
    } catch (error) {
      throw handleServerError(error, 'Create organization');
    }
  });

export const createOrganizationInvitationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationInvitationSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'invite',
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        nextRole: data.role,
        resend: data.resend === true,
      });

      return await createBetterAuthOrganizationInvitation(
        {
          organizationId: data.organizationId,
          email: data.email.trim().toLowerCase(),
          role: data.role,
          ...(data.resend === true ? { resend: true } : {}),
        },
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Create organization invitation');
    }
  });

export const updateOrganizationPoliciesServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationPoliciesSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.updateOrganizationPolicies,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Update organization policies');
    }
  });

export const createOrganizationSupportAccessGrantServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationSupportAccessGrantSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.createOrganizationSupportAccessGrant,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Create support access grant');
    }
  });

export const revokeOrganizationSupportAccessGrantServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationSupportAccessGrantRevocationSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.revokeOrganizationSupportAccessGrant,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Revoke support access grant');
    }
  });

export const applyOrganizationLegalHoldServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationLegalHoldApplySchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.applyOrganizationLegalHold,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Apply organization legal hold');
    }
  });

export const releaseOrganizationLegalHoldServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationLegalHoldReleaseSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.releaseOrganizationLegalHold,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Release organization legal hold');
    }
  });

export const generateOrganizationScimTokenServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationEnterpriseProviderSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'manage-scim',
        organizationId: data.organizationId,
      });

      return await generateBetterAuthOrganizationScimToken(data, ({ code, message, status }) =>
        normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Generate organization SCIM token');
    }
  });

export const deleteOrganizationScimProviderServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationEnterpriseProviderSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'manage-scim',
        organizationId: data.organizationId,
      });

      return await deleteBetterAuthOrganizationScimProvider(data, ({ code, message, status }) =>
        normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Delete organization SCIM provider');
    }
  });

export const exportOrganizationAuditCsvServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationAuditExportSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(
        api.organizationManagement.exportOrganizationAuditCsv,
        {
          ...data,
          eventType: data.eventType as never,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Export organization audit log');
    }
  });

export const exportOrganizationDirectoryCsvServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationDirectoryExportSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      const requestContext = resolveRequestAuditContext(getBetterAuthRequest());

      return await convexAuthReactStart.fetchAuthAction(
        api.organizationManagement.exportOrganizationDirectoryCsv,
        {
          ...data,
          requestContext,
        },
      );
    } catch (error) {
      throw handleServerError(error, 'Export organization directory');
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

      return await updateBetterAuthOrganizationMemberRole(
        {
          organizationId: data.organizationId,
          memberId: data.membershipId,
          role: data.role,
        },
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
      );
    } catch (error) {
      throw handleServerError(error, 'Update organization member role');
    }
  });

export const suspendOrganizationMemberServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationMemberStateSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'suspend-member',
        organizationId: data.organizationId,
        membershipId: data.membershipId,
      });

      const result = await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.suspendOrganizationMember,
        data,
      );
      await refreshCurrentUserContext();
      return result;
    } catch (error) {
      throw handleServerError(error, 'Suspend organization member');
    }
  });

export const deactivateOrganizationMemberServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationMemberStateSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'deactivate-member',
        organizationId: data.organizationId,
        membershipId: data.membershipId,
      });

      const result = await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.deactivateOrganizationMember,
        data,
      );
      await refreshCurrentUserContext();
      return result;
    } catch (error) {
      throw handleServerError(error, 'Deactivate organization member');
    }
  });

export const reactivateOrganizationMemberServerFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      organizationId: z.string().min(1),
      membershipId: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    try {
      await requireAuth();
      await requireOrganizationWriteAccess({
        action: 'reactivate-member',
        organizationId: data.organizationId,
        membershipId: data.membershipId,
      });

      const result = await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.reactivateOrganizationMember,
        data,
      );
      await refreshCurrentUserContext();
      return result;
    } catch (error) {
      throw handleServerError(error, 'Reactivate organization member');
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

      const response = await removeBetterAuthOrganizationMember(
        {
          organizationId: data.organizationId,
          memberIdOrEmail: data.membershipId,
        },
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
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

      return await cancelBetterAuthOrganizationInvitation(
        data.invitationId,
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
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

      return await updateBetterAuthOrganization(
        {
          organizationId: data.organizationId,
          data: {
            name: data.name.trim(),
            ...(data.logo?.trim() ? { logo: data.logo.trim() } : {}),
          },
        },
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
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
      const cleanupPreparation = await convexAuthReactStart.fetchAuthMutation(
        api.organizationManagement.prepareOrganizationCleanup,
        {
          organizationId: data.organizationId,
        },
      );

      const response = await deleteBetterAuthOrganization(
        data.organizationId,
        ({ code, message, status }) =>
          normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
      );

      try {
        await convexAuthReactStart.fetchAuthAction(
          api.organizationManagement.executePreparedOrganizationCleanup,
          {
            cleanupRequestId: cleanupPreparation.cleanupRequestId,
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

export const bulkOrganizationDirectoryActionServerFn = createServerFn({ method: 'POST' })
  .inputValidator(organizationBulkActionSchema)
  .handler(async ({ data }) => {
    try {
      await requireAuth();

      const results: Array<{
        key: string;
        message?: string;
        success: boolean;
      }> = [];

      if (data.action === 'revoke-invites') {
        for (const invitation of data.invitations) {
          try {
            await requireOrganizationWriteAccess({
              action: 'cancel-invitation',
              organizationId: data.organizationId,
            });
            await cancelBetterAuthOrganizationInvitation(
              invitation.invitationId,
              ({ code, message, status }) =>
                normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
            );
            results.push({ key: invitation.invitationId, success: true });
          } catch (error) {
            results.push({
              key: invitation.invitationId,
              success: false,
              message: error instanceof Error ? error.message : 'Failed to revoke invitation',
            });
          }
        }

        const successful = data.invitations.filter((invitation) =>
          results.some((result) => result.key === invitation.invitationId && result.success),
        );
        if (successful.length > 0) {
          await recordBulkOrganizationAuditEvents({
            organizationId: data.organizationId,
            eventType: 'bulk_invite_revoked',
            entries: successful.map((invitation) => ({
              targetEmail: invitation.email.toLowerCase(),
              targetId: invitation.invitationId,
              targetRole: invitation.role,
            })),
          });
        }
      }

      if (data.action === 'resend-invites') {
        for (const invitation of data.invitations) {
          try {
            await requireOrganizationWriteAccess({
              action: 'invite',
              organizationId: data.organizationId,
              email: invitation.email.toLowerCase(),
              nextRole: invitation.role,
              resend: true,
            });
            await createBetterAuthOrganizationInvitation(
              {
                organizationId: data.organizationId,
                email: invitation.email.toLowerCase(),
                role: invitation.role,
                resend: true,
              },
              ({ code, message, status }) =>
                normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
            );
            results.push({ key: invitation.invitationId, success: true });
          } catch (error) {
            results.push({
              key: invitation.invitationId,
              success: false,
              message: error instanceof Error ? error.message : 'Failed to resend invitation',
            });
          }
        }

        const successful = data.invitations.filter((invitation) =>
          results.some((result) => result.key === invitation.invitationId && result.success),
        );
        if (successful.length > 0) {
          await recordBulkOrganizationAuditEvents({
            organizationId: data.organizationId,
            eventType: 'bulk_invite_resent',
            entries: successful.map((invitation) => ({
              targetEmail: invitation.email.toLowerCase(),
              targetId: invitation.invitationId,
              targetRole: invitation.role,
            })),
          });
        }
      }

      if (data.action === 'remove-members') {
        for (const member of data.members) {
          try {
            await requireOrganizationWriteAccess({
              action: 'remove-member',
              organizationId: data.organizationId,
              membershipId: member.membershipId,
            });
            await removeBetterAuthOrganizationMember(
              {
                organizationId: data.organizationId,
                memberIdOrEmail: member.membershipId,
              },
              ({ code, message, status }) =>
                normalizeOrganizationAuthErrorMessage(code ?? undefined, message, status),
            );
            results.push({ key: member.membershipId, success: true });
          } catch (error) {
            results.push({
              key: member.membershipId,
              success: false,
              message: error instanceof Error ? error.message : 'Failed to remove member',
            });
          }
        }

        const successful = data.members.filter((member) =>
          results.some((result) => result.key === member.membershipId && result.success),
        );
        if (successful.length > 0) {
          await recordBulkOrganizationAuditEvents({
            organizationId: data.organizationId,
            eventType: 'bulk_member_removed',
            entries: successful.map((member) => ({
              targetEmail: member.email.toLowerCase(),
              targetId: member.membershipId,
              targetRole: member.role,
            })),
          });
          await refreshCurrentUserContext();
        }
      }

      const successCount = results.filter((result) => result.success).length;
      const failures = results.filter((result) => !result.success);

      return {
        results,
        successCount,
        failureCount: failures.length,
      };
    } catch (error) {
      throw handleServerError(error, 'Run bulk organization action');
    }
  });
