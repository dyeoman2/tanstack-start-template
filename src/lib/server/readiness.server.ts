import { getDomainDnsResolverUrl } from '~/lib/server/env.server';

export type ReadinessWarning = {
  code: 'domain_dns_resolver_invalid' | 'domain_dns_resolver_missing';
  message: string;
  surface: 'organization_domains';
};

export function getInternalReadinessWarnings(): ReadinessWarning[] {
  try {
    if (getDomainDnsResolverUrl()) {
      return [];
    }

    return [
      {
        code: 'domain_dns_resolver_missing',
        message:
          'DOMAIN_DNS_RESOLVER_URL is not configured. Organization domain verification and DNS provider detection will fail closed.',
        surface: 'organization_domains',
      },
    ];
  } catch (error) {
    return [
      {
        code: 'domain_dns_resolver_invalid',
        message: error instanceof Error ? error.message : 'DOMAIN_DNS_RESOLVER_URL is invalid.',
        surface: 'organization_domains',
      },
    ];
  }
}
