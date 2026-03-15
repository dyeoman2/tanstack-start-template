import { v } from 'convex/values';
import {
  canManageDomains,
  deriveViewerRole,
} from '../src/features/organizations/lib/organization-permissions';
import type { OrganizationDomainVerificationResult } from '../src/features/organizations/lib/organization-management';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { getVerifiedCurrentUserFromActionOrThrow } from './auth/access';
import { throwConvexError } from './auth/errors';
import { findBetterAuthMember, findBetterAuthOrganizationById } from './lib/betterAuth';
import { organizationDomainVerificationResultValidator } from './lib/returnValidators';

const ORGANIZATION_DOMAIN_VERIFICATION_PREFIX = '_ba-verify';
const ORGANIZATION_DOMAIN_DNS_ENDPOINT = 'https://dns.google/resolve';
const ORGANIZATION_DOMAIN_DNS_TIMEOUT_MS = 5_000;

function getOrganizationDomainVerificationRecordName(domain: string) {
  return `${ORGANIZATION_DOMAIN_VERIFICATION_PREFIX}.${domain}`;
}

function getOrganizationDomainVerificationRecordValue(token: string) {
  return `better-auth-verify=${token}`;
}

async function verifyOrganizationDomainHandler(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    domainId: Doc<'organizationDomains'>['_id'];
  },
): Promise<OrganizationDomainVerificationResult> {
  const user = await getVerifiedCurrentUserFromActionOrThrow(ctx);
  if (!(await findBetterAuthOrganizationById(ctx, args.organizationId))) {
    throwConvexError('NOT_FOUND', 'Organization not found');
  }

  const viewerMembership = await findBetterAuthMember(ctx, args.organizationId, user.authUserId);
  const viewerRole = deriveViewerRole({
    isSiteAdmin: user.isSiteAdmin,
    membershipRole: viewerMembership?.role,
  });
  const domain: Doc<'organizationDomains'> | null = await ctx.runQuery(
    internal.organizationManagement.getOrganizationDomainInternal,
    {
      domainId: args.domainId,
    },
  );

  if (!user.isSiteAdmin && !viewerMembership) {
    throwConvexError('NOT_FOUND', 'Organization not found');
  }

  if (!canManageDomains(viewerRole)) {
    throwConvexError('FORBIDDEN', 'Organization owner access required');
  }

  if (!domain || domain.organizationId !== args.organizationId) {
    throwConvexError('NOT_FOUND', 'Organization domain not found');
  }

  const checkedAt = Date.now();
  const recordName = getOrganizationDomainVerificationRecordName(domain.normalizedDomain);
  const expectedValue = getOrganizationDomainVerificationRecordValue(domain.verificationToken);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORGANIZATION_DOMAIN_DNS_TIMEOUT_MS);
  let payload:
    | {
        Answer?: Array<{ data?: string }>;
      }
    | null = null;

  try {
    const response = await fetch(
      `${ORGANIZATION_DOMAIN_DNS_ENDPOINT}?name=${encodeURIComponent(recordName)}&type=TXT`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      throw new Error(`Resolver responded with ${response.status}`);
    }

    payload = (await response.json().catch(() => null)) as
      | {
          Answer?: Array<{ data?: string }>;
        }
      | null;
  } catch (error) {
    clearTimeout(timeout);

    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: 'domain_verification_failed',
      organizationId: args.organizationId,
      userId: user.authUserId,
      metadata: JSON.stringify({
        domain: domain.domain,
        domainId: args.domainId,
        recordName,
        expectedValue,
        error: error instanceof Error ? error.message : 'resolver_unavailable',
      }),
    });

    return {
      verified: false,
      checkedAt,
      domain: {
        id: domain._id,
        organizationId: domain.organizationId,
        domain: domain.domain,
        normalizedDomain: domain.normalizedDomain,
        status: domain.status,
        verificationMethod: domain.verificationMethod,
        verificationToken: domain.verificationToken,
        verificationRecordName: recordName,
        verificationRecordValue: expectedValue,
        verifiedAt: domain.verifiedAt,
        createdByUserId: domain.createdByUserId,
        createdAt: domain.createdAt,
      },
      reason: 'DNS verification is temporarily unavailable. Try again in a moment.',
    };
  } finally {
    clearTimeout(timeout);
  }
  const resolvedValues =
    payload?.Answer?.flatMap((answer) =>
      typeof answer.data === 'string'
        ? answer.data
            .split(/\s+/)
            .map((value) => value.replaceAll('"', '').trim())
            .filter(Boolean)
        : [],
    ) ?? [];
  const matched = resolvedValues.includes(expectedValue);

  if (!matched) {
    await ctx.runMutation(internal.audit.insertAuditLog, {
      eventType: 'domain_verification_failed',
      organizationId: args.organizationId,
      userId: user.authUserId,
      metadata: JSON.stringify({
        domain: domain.domain,
        domainId: args.domainId,
        recordName,
        expectedValue,
      }),
    });

    return {
      verified: false,
      checkedAt,
      domain: {
        id: domain._id,
        organizationId: domain.organizationId,
        domain: domain.domain,
        normalizedDomain: domain.normalizedDomain,
        status: domain.status,
        verificationMethod: domain.verificationMethod,
        verificationToken: domain.verificationToken,
        verificationRecordName: recordName,
        verificationRecordValue: expectedValue,
        verifiedAt: domain.verifiedAt,
        createdByUserId: domain.createdByUserId,
        createdAt: domain.createdAt,
      },
      reason: `DNS TXT record ${recordName} did not contain ${expectedValue}`,
    };
  }

  const verifiedDomain: OrganizationDomainVerificationResult['domain'] = await ctx.runMutation(
    internal.organizationManagement.setOrganizationDomainVerifiedInternal,
    {
      domainId: args.domainId,
      verifiedAt: checkedAt,
    },
  );

  await ctx.runMutation(internal.audit.insertAuditLog, {
    eventType: 'domain_verification_succeeded',
    organizationId: args.organizationId,
    userId: user.authUserId,
    metadata: JSON.stringify({
      domain: domain.domain,
      domainId: args.domainId,
      recordName,
    }),
  });

  return {
    verified: true,
    checkedAt,
    domain: verifiedDomain,
    reason: null,
  };
}

export const verifyOrganizationDomain = action({
  args: {
    organizationId: v.string(),
    domainId: v.id('organizationDomains'),
  },
  returns: organizationDomainVerificationResultValidator,
  handler: verifyOrganizationDomainHandler,
});
