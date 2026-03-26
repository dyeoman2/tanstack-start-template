import type { GenericCtx } from '@convex-dev/better-auth';
import { APIError } from 'better-auth/api';
import { anyApi } from 'convex/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { shouldCreateEnterpriseJitMembership } from '../../src/features/auth/lib/enterprise-jit';
import { deriveIsSiteAdmin, normalizeUserRole } from '../../src/features/auth/lib/user-role';
import {
  getGoogleOAuthCredentials,
  isGoogleWorkspaceOAuthConfigured,
} from '../../src/lib/server/env.server';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import {
  fetchBetterAuthMembersByUserId,
  fetchBetterAuthOrganizationsByIds,
  findBetterAuthAccountByUserIdAndProviderId,
  findBetterAuthMember,
  findBetterAuthScimProviderById,
} from '../lib/betterAuth';
import {
  getOrganizationMembershipStateByOrganizationUser,
  getOrganizationMembershipStatuses,
} from '../lib/organizationMembershipState';

const GOOGLE_WORKSPACE_PROVIDER_KEY = 'google-workspace' as const;
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

type CtxWithRunMutation = GenericCtx<DataModel> & {
  runMutation?: (fn: unknown, args: unknown) => Promise<unknown>;
};

function normalizeOptionalId(value: string | null | undefined) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function ensureEnterpriseOrganizationMembership(
  ctx: GenericCtx<DataModel>,
  input: {
    organizationId: string;
    userId: string;
  },
) {
  const existingMembership = await findBetterAuthMember(ctx, input.organizationId, input.userId);
  const existingState = await getOrganizationMembershipStateByOrganizationUser(
    ctx,
    input.organizationId,
    input.userId,
  );
  if (
    !shouldCreateEnterpriseJitMembership({
      existingMembership: existingMembership !== null,
      membershipStateStatus: existingState?.status ?? null,
    })
  ) {
    return existingMembership !== null;
  }

  const ctxWithRunMutation = ctx as CtxWithRunMutation;
  if (!ctxWithRunMutation.runMutation) {
    return false;
  }

  await ctxWithRunMutation.runMutation(components.betterAuth.adapter.create, {
    input: {
      model: 'member',
      data: {
        createdAt: Date.now(),
        organizationId: input.organizationId,
        role: 'member',
        userId: input.userId,
      },
    },
  });

  return true;
}

export async function deriveGoogleHostedDomainFromIdToken(idToken: string): Promise<string | null> {
  const credentials = getGoogleOAuthCredentials();
  if (!credentials) {
    return null;
  }

  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    audience: credentials.clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  });

  const hostedDomain = typeof payload.hd === 'string' ? payload.hd.trim().toLowerCase() : null;
  const emailVerified = payload.email_verified === true;

  if (!emailVerified || !hostedDomain) {
    return null;
  }

  return hostedDomain;
}

async function isSiteAdminUser(ctx: GenericCtx<DataModel>, userId: string) {
  const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [
      {
        field: '_id',
        operator: 'eq',
        value: userId,
      },
    ],
  });

  return deriveIsSiteAdmin(normalizeUserRole(user?.role));
}

async function isOrganizationOwner(
  ctx: GenericCtx<DataModel>,
  userId: string,
  organizationId: string,
) {
  const member = await findBetterAuthMember(ctx, organizationId, userId);
  return member?.role === 'owner';
}

export async function canUserSelfServeCreateOrganization(
  ctx: GenericCtx<DataModel>,
  user: { id: string; role?: string | null },
) {
  if (deriveIsSiteAdmin(normalizeUserRole(user.role ?? undefined))) {
    return true;
  }

  const memberships = await fetchBetterAuthMembersByUserId(ctx, user.id);
  return memberships.length < 2;
}

export async function getPasswordAuthBlockMessage(
  ctx: GenericCtx<DataModel>,
  email: string,
): Promise<string | null> {
  const resolution = await ctx.runQuery(
    anyApi.organizationManagement.resolveOrganizationEnterpriseAuthByEmailInternal,
    { email },
  );
  if (!resolution) {
    return null;
  }

  if (resolution.requiresEnterpriseAuth && !resolution.canUsePasswordFallback) {
    return 'This email domain requires organization-managed sign-in. Use Continue with Google.';
  }

  return null;
}

export async function assertScimManagementAccess(
  ctx: GenericCtx<DataModel>,
  input: {
    organizationId?: string;
    providerId?: string;
    userId: string;
  },
) {
  if (await isSiteAdminUser(ctx, input.userId)) {
    return;
  }

  let organizationId = input.organizationId ?? null;
  if (!organizationId && input.providerId) {
    organizationId =
      (await findBetterAuthScimProviderById(ctx, input.providerId))?.organizationId ?? null;
  }

  if (organizationId) {
    if (await isOrganizationOwner(ctx, input.userId, organizationId)) {
      return;
    }

    throw new APIError('FORBIDDEN', {
      message: 'Organization owner access required to manage SCIM.',
    });
  }

  const memberships = await fetchBetterAuthMembersByUserId(ctx, input.userId);
  if (memberships.some((membership) => membership.role === 'owner')) {
    return;
  }

  throw new APIError('FORBIDDEN', {
    message: 'Organization owner access required to manage SCIM.',
  });
}

export async function resolveEnterpriseSessionContext(
  ctx: GenericCtx<DataModel>,
  input: {
    providerId: string;
    userEmail: string;
    userId: string;
  },
): Promise<{
  organizationId: string;
  protocol: 'oidc';
  providerKey: 'google-workspace' | 'entra' | 'okta';
} | null> {
  if (input.providerId !== 'google' || !isGoogleWorkspaceOAuthConfigured()) {
    return null;
  }

  const googleAccount = await findBetterAuthAccountByUserIdAndProviderId(
    ctx,
    input.userId,
    'google',
  );
  const hostedDomain = googleAccount?.googleHostedDomain ?? null;
  if (!hostedDomain) {
    return null;
  }

  const resolution = await ctx.runQuery(
    anyApi.organizationManagement.resolveOrganizationEnterpriseAuthByEmailInternal,
    { email: input.userEmail },
  );
  if (!resolution || resolution.providerKey !== GOOGLE_WORKSPACE_PROVIDER_KEY) {
    return null;
  }

  if (resolution.providerStatus !== 'active') {
    return null;
  }

  if (hostedDomain !== resolution.managedDomain) {
    return null;
  }

  const hasEnterpriseMembership = await ensureEnterpriseOrganizationMembership(ctx, {
    organizationId: resolution.organizationId,
    userId: input.userId,
  });
  if (!hasEnterpriseMembership) {
    return null;
  }

  return {
    organizationId: resolution.organizationId,
    protocol: 'oidc',
    providerKey: resolution.providerKey,
  };
}

export async function resolveInitialActiveOrganizationId(
  ctx: GenericCtx<DataModel>,
  authUserId: string,
  preferredOrganizationId?: string | null,
) {
  const memberships = await fetchBetterAuthMembersByUserId(ctx, authUserId);
  if (memberships.length === 0) {
    return null;
  }

  const membershipStatuses = await getOrganizationMembershipStatuses(
    ctx,
    memberships.map((membership) => membership._id),
  );

  const organizations = await fetchBetterAuthOrganizationsByIds(
    ctx,
    memberships.map((membership) => membership.organizationId),
  );
  const organizationIds = new Set(
    organizations.map((organization) => organization._id ?? organization.id).filter(Boolean),
  );

  const normalizedPreferredOrganizationId = normalizeOptionalId(preferredOrganizationId);
  if (
    normalizedPreferredOrganizationId &&
    organizationIds.has(normalizedPreferredOrganizationId) &&
    memberships.some(
      (membership) =>
        membership.organizationId === normalizedPreferredOrganizationId &&
        (membershipStatuses.get(membership._id) ?? 'active') === 'active',
    )
  ) {
    return normalizedPreferredOrganizationId;
  }

  const activeMembership = memberships.find(
    (membership) =>
      organizationIds.has(membership.organizationId) &&
      (membershipStatuses.get(membership._id) ?? 'active') === 'active',
  );

  return activeMembership?.organizationId ?? null;
}
