import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config';
import type { AuthProvider } from 'convex/server';

type BetterAuthJwksDoc = {
  alg?: string;
  createdAt: number;
  crv?: string;
  expiresAt?: number;
  id: string;
  privateKey?: string;
  publicKey: string;
};

type PublicJwks = {
  keys: JsonWebKey[];
};

type ParsedStaticJwks =
  | {
      kind: 'better-auth-docs';
      raw: string;
      value: BetterAuthJwksDoc[];
    }
  | {
      kind: 'public-jwks';
      raw: string;
      value: PublicJwks;
    }
  | {
      kind: 'missing';
    }
  | {
      kind: 'unsupported';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBetterAuthJwksDoc(value: unknown): value is BetterAuthJwksDoc {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === 'string' && typeof value.publicKey === 'string';
}

function isPublicJwks(value: unknown): value is PublicJwks {
  return isRecord(value) && Array.isArray(value.keys);
}

function parseStaticJwks(rawJwks: string | undefined): ParsedStaticJwks {
  const trimmed = rawJwks?.trim();
  if (!trimmed) {
    return { kind: 'missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'unsupported' };
  }

  if (Array.isArray(parsed) && parsed.every(isBetterAuthJwksDoc)) {
    return {
      kind: 'better-auth-docs',
      raw: trimmed,
      value: parsed,
    };
  }

  if (isPublicJwks(parsed)) {
    return {
      kind: 'public-jwks',
      raw: trimmed,
      value: parsed,
    };
  }

  return { kind: 'unsupported' };
}

function asDataUri(value: PublicJwks): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value))}`;
}

export function resolveAuthConfigProvider(rawJwks: string | undefined): AuthProvider {
  const parsed = parseStaticJwks(rawJwks);

  if (parsed.kind === 'better-auth-docs') {
    return getAuthConfigProvider({ jwks: parsed.raw });
  }

  if (parsed.kind === 'public-jwks') {
    return {
      type: 'customJwt',
      issuer: `${process.env.CONVEX_SITE_URL}`,
      applicationID: 'convex',
      algorithm: 'RS256',
      jwks: asDataUri(parsed.value),
    } satisfies AuthProvider;
  }

  return getAuthConfigProvider();
}

export function resolveBetterAuthPluginJwks(rawJwks: string | undefined): string | undefined {
  const parsed = parseStaticJwks(rawJwks);
  return parsed.kind === 'better-auth-docs' ? parsed.raw : undefined;
}
