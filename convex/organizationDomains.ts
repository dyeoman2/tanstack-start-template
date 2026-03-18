import { generateObject } from 'ai';
import { v } from 'convex/values';
import { z } from 'zod';
import type { OrganizationDomainVerificationResult } from '../src/features/organizations/lib/organization-management';
import {
  canManageDomains,
  deriveViewerRole,
} from '../src/features/organizations/lib/organization-permissions';
import { DEFAULT_CHAT_MODEL_ID } from '../src/lib/shared/chat-models';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { getVerifiedCurrentUserFromActionOrThrow } from './auth/access';
import { throwConvexError } from './auth/errors';
import { getOpenRouterProvider, getOpenRouterProviderOptions } from './lib/agentChat';
import { findBetterAuthMember, findBetterAuthOrganizationById } from './lib/betterAuth';
import { organizationDomainVerificationResultValidator } from './lib/returnValidators';

const ORGANIZATION_DOMAIN_VERIFICATION_PREFIX = '_ba-verify';
const ORGANIZATION_DOMAIN_DNS_ENDPOINT = 'https://dns.google/resolve';
const ORGANIZATION_DOMAIN_DNS_TIMEOUT_MS = 5_000;
const ORGANIZATION_DOMAIN_PROVIDER_URLS = {
  cloudflare: 'https://dash.cloudflare.com/',
  route53: 'https://console.aws.amazon.com/route53/v2/hostedzones',
  godaddy: 'https://dcc.godaddy.com/manage/dns',
  namecheap: 'https://ap.www.namecheap.com/domains/domaincontrolpanel/',
  googleCloudDns: 'https://console.cloud.google.com/net-services/dns/zones',
  azureDns:
    'https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Network%2Fdnszones',
  dnsimple: 'https://dnsimple.com/a',
  ns1: 'https://my.nsone.net/',
  vercel: 'https://vercel.com/dashboard/domains',
  wix: 'https://manage.wix.com/account/domains',
  squarespace: 'https://account.squarespace.com/domains',
} as const;

type DnsProviderHint = {
  providerName: string | null;
  providerUrl: string | null;
  confidence: 'high' | 'medium' | null;
};

const DNS_PROVIDER_MATCHERS: Array<{
  key: keyof typeof ORGANIZATION_DOMAIN_PROVIDER_URLS;
  label: string;
  confidence: DnsProviderHint['confidence'];
  patterns: RegExp[];
}> = [
  {
    key: 'cloudflare',
    label: 'Cloudflare',
    confidence: 'high',
    patterns: [/\.ns\.cloudflare\.com\.?$/i],
  },
  {
    key: 'route53',
    label: 'Amazon Route 53',
    confidence: 'high',
    patterns: [/\.awsdns-[\w-]+\.\w+\.?$/i],
  },
  {
    key: 'godaddy',
    label: 'GoDaddy',
    confidence: 'high',
    patterns: [/\.domaincontrol\.com\.?$/i],
  },
  {
    key: 'namecheap',
    label: 'Namecheap',
    confidence: 'high',
    patterns: [/\.registrar-servers\.com\.?$/i],
  },
  {
    key: 'googleCloudDns',
    label: 'Google Cloud DNS',
    confidence: 'medium',
    patterns: [/\.googledomains\.com\.?$/i, /\.google\.com\.?$/i],
  },
  {
    key: 'azureDns',
    label: 'Azure DNS',
    confidence: 'high',
    patterns: [/\.azure-dns\.(com|net|org|info)\.?$/i],
  },
  {
    key: 'dnsimple',
    label: 'DNSimple',
    confidence: 'high',
    patterns: [/\.dnsimple\.com\.?$/i],
  },
  {
    key: 'ns1',
    label: 'NS1',
    confidence: 'high',
    patterns: [/\.nsone\.net\.?$/i],
  },
  {
    key: 'vercel',
    label: 'Vercel',
    confidence: 'high',
    patterns: [/\.vercel-dns\.com\.?$/i],
  },
  {
    key: 'wix',
    label: 'Wix',
    confidence: 'high',
    patterns: [/\.wixdns\.net\.?$/i],
  },
  {
    key: 'squarespace',
    label: 'Squarespace',
    confidence: 'high',
    patterns: [/\.squarespacedns\.com\.?$/i],
  },
];
const DNS_PROVIDER_ALIAS_MAP = new Map(
  DNS_PROVIDER_MATCHERS.flatMap((matcher) => [
    [matcher.label.toLowerCase(), matcher.key],
    [matcher.label.replaceAll(' ', '').toLowerCase(), matcher.key],
  ]),
);
const dnsProviderDetectionSchema = z.object({
  providerName: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low', 'none']),
  reason: z.string(),
});
const organizationDomainDnsProviderHintValidator = v.object({
  domainId: v.id('organizationDomains'),
  providerName: v.union(v.string(), v.null()),
  providerUrl: v.union(v.string(), v.null()),
  confidence: v.union(v.literal('high'), v.literal('medium'), v.null()),
});

function getOrganizationDomainVerificationRecordName(domain: string) {
  return `${ORGANIZATION_DOMAIN_VERIFICATION_PREFIX}.${domain}`;
}

function getOrganizationDomainVerificationRecordValue(token: string) {
  return `better-auth-verify=${token}`;
}

function inferDnsProviderFromNameservers(nameservers: string[]): DnsProviderHint {
  for (const matcher of DNS_PROVIDER_MATCHERS) {
    if (
      nameservers.some((nameserver) => matcher.patterns.some((pattern) => pattern.test(nameserver)))
    ) {
      return {
        providerName: matcher.label,
        providerUrl: ORGANIZATION_DOMAIN_PROVIDER_URLS[matcher.key],
        confidence: matcher.confidence,
      };
    }
  }

  return {
    providerName: null,
    providerUrl: null,
    confidence: null,
  };
}

async function inferDnsProviderWithAi(args: {
  domain: string;
  nameservers: string[];
}): Promise<DnsProviderHint> {
  if (args.nameservers.length === 0) {
    return {
      providerName: null,
      providerUrl: null,
      confidence: null,
    };
  }

  try {
    const result = await generateObject({
      model: getOpenRouterProvider().chat(DEFAULT_CHAT_MODEL_ID),
      schema: dnsProviderDetectionSchema,
      providerOptions: getOpenRouterProviderOptions({
        modelId: DEFAULT_CHAT_MODEL_ID,
        useWebSearch: false,
        supportsWebSearch: false,
      }),
      prompt: [
        'Classify the most likely DNS hosting provider from the domain and nameserver list.',
        'Return a provider only if the nameservers strongly suggest a well-known DNS host.',
        'If unsure, return providerName as null.',
        'Only use one of these provider names when applicable: Cloudflare, Amazon Route 53, GoDaddy, Namecheap, Google Cloud DNS, Azure DNS, DNSimple, NS1, Vercel, Wix, Squarespace.',
        `Domain: ${args.domain}`,
        `Nameservers: ${args.nameservers.join(', ')}`,
      ].join('\n'),
    });

    const providerName = result.object.providerName?.trim() ?? null;
    const confidence = result.object.confidence;
    if (!providerName || confidence === 'none' || confidence === 'low') {
      return {
        providerName: null,
        providerUrl: null,
        confidence: null,
      };
    }

    const normalizedKey =
      DNS_PROVIDER_ALIAS_MAP.get(providerName.toLowerCase()) ??
      DNS_PROVIDER_ALIAS_MAP.get(providerName.replaceAll(' ', '').toLowerCase());
    if (!normalizedKey) {
      return {
        providerName: null,
        providerUrl: null,
        confidence: null,
      };
    }

    const matchedProvider = DNS_PROVIDER_MATCHERS.find((matcher) => matcher.key === normalizedKey);
    if (!matchedProvider) {
      return {
        providerName: null,
        providerUrl: null,
        confidence: null,
      };
    }

    return {
      providerName: matchedProvider.label,
      providerUrl: ORGANIZATION_DOMAIN_PROVIDER_URLS[matchedProvider.key],
      confidence: confidence === 'high' ? 'high' : 'medium',
    };
  } catch {
    return {
      providerName: null,
      providerUrl: null,
      confidence: null,
    };
  }
}

async function resolveDnsAnswers(
  name: string,
  type: 'TXT' | 'NS',
): Promise<Array<{ data?: string }> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORGANIZATION_DOMAIN_DNS_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${ORGANIZATION_DOMAIN_DNS_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      throw new Error(`Resolver responded with ${response.status}`);
    }

    const payload = (await response.json().catch(() => null)) as {
      Answer?: Array<{ data?: string }>;
    } | null;

    return payload?.Answer ?? null;
  } finally {
    clearTimeout(timeout);
  }
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

  try {
    const answers = await resolveDnsAnswers(recordName, 'TXT');
    const resolvedValues =
      answers?.flatMap((answer) =>
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
  } catch (error) {
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

export const detectOrganizationDomainDnsProvider = action({
  args: {
    organizationId: v.string(),
    domainId: v.id('organizationDomains'),
  },
  returns: organizationDomainDnsProviderHintValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    domainId: Doc<'organizationDomains'>['_id'];
    providerName: string | null;
    providerUrl: string | null;
    confidence: 'high' | 'medium' | null;
  }> => {
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

    try {
      const answers = await resolveDnsAnswers(domain.normalizedDomain, 'NS');
      const nameservers =
        answers?.flatMap((answer) =>
          typeof answer.data === 'string' ? [answer.data.replaceAll('"', '').trim()] : [],
        ) ?? [];
      const inferredProvider = inferDnsProviderFromNameservers(nameservers);
      if (inferredProvider.providerName) {
        return {
          domainId: args.domainId,
          ...inferredProvider,
        };
      }

      return {
        domainId: args.domainId,
        ...(await inferDnsProviderWithAi({
          domain: domain.normalizedDomain,
          nameservers,
        })),
      };
    } catch {
      return {
        domainId: args.domainId,
        providerName: null,
        providerUrl: null,
        confidence: null,
      };
    }
  },
});
