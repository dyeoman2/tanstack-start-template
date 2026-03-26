'use node';

import { fetchWithAwsSigv4 } from '../../src/lib/server/aws-sigv4';
import { getStorageRuntimeConfig } from '../../src/lib/server/env.server';
import {
  createStorageBrokerSessionRequest,
  STORAGE_BROKER_SESSION_REFRESH_WINDOW_MS,
} from '../../src/lib/shared/storage-broker-session';
import type {
  StorageBrokerSessionRequest,
  StorageBrokerSessionResponse,
  StorageBrokerTrustTier,
  StorageServiceReadObjectRequest,
} from '../../src/lib/shared/storage-service-contract';

type CachedBrokerSession = StorageBrokerSessionResponse;

type StorageObjectResponse = {
  Body: Blob;
  ContentType?: string;
  VersionId?: string | null;
};

const brokerSessionCache = new Map<StorageBrokerTrustTier, Promise<CachedBrokerSession>>();

function getBrokerSessionPath(tier: StorageBrokerTrustTier) {
  return `/internal/storage/session/${tier}`;
}

function buildUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  return text || `${response.status} ${response.statusText}`;
}

function getRequiredBrokerService(tier: StorageBrokerTrustTier) {
  const service = getStorageRuntimeConfig().services.broker;
  const assertionSecret =
    tier === 'edge' ? service.edgeAssertionSecret : service.controlAssertionSecret;
  if (!service.baseUrl || !assertionSecret) {
    throw new Error(`Storage broker service is not configured for ${tier} operations.`);
  }

  return {
    assertionSecret,
    baseUrl: service.baseUrl,
  };
}

async function issueBrokerSession(
  tier: StorageBrokerTrustTier,
): Promise<StorageBrokerSessionResponse> {
  const service = getRequiredBrokerService(tier);
  const requestBody: StorageBrokerSessionRequest = await createStorageBrokerSessionRequest({
    secret: service.assertionSecret,
    tier,
  });
  const response = await fetch(buildUrl(service.baseUrl, getBrokerSessionPath(tier)), {
    body: JSON.stringify(requestBody),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as StorageBrokerSessionResponse;
}

async function getBrokerSession(
  tier: StorageBrokerTrustTier,
): Promise<StorageBrokerSessionResponse> {
  const cached = brokerSessionCache.get(tier);
  if (cached) {
    try {
      const session = await cached;
      if (session.expiresAt > Date.now() + STORAGE_BROKER_SESSION_REFRESH_WINDOW_MS) {
        return session;
      }
      brokerSessionCache.delete(tier);
    } catch {
      brokerSessionCache.delete(tier);
    }
  }

  const sessionPromise = issueBrokerSession(tier);
  brokerSessionCache.set(tier, sessionPromise);
  try {
    return await sessionPromise;
  } catch (error) {
    brokerSessionCache.delete(tier);
    throw error;
  }
}

export async function requestStorageBrokerJson<TResponse>(args: {
  body: unknown;
  path: string;
  tier: StorageBrokerTrustTier;
}) {
  const service = getRequiredBrokerService(args.tier);
  const runtimeConfig = getStorageRuntimeConfig();
  const session = await getBrokerSession(args.tier);
  const response = await fetchWithAwsSigv4({
    body: JSON.stringify(args.body),
    credentials: {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      sessionToken: session.sessionToken,
    },
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    region: runtimeConfig.awsRegion ?? 'us-west-1',
    url: buildUrl(service.baseUrl, args.path),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

export async function requestStorageBrokerObjectRead(args: {
  body: StorageServiceReadObjectRequest;
  path: string;
  tier: StorageBrokerTrustTier;
}): Promise<StorageObjectResponse> {
  const service = getRequiredBrokerService(args.tier);
  const runtimeConfig = getStorageRuntimeConfig();
  const session = await getBrokerSession(args.tier);
  const response = await fetchWithAwsSigv4({
    body: JSON.stringify(args.body),
    credentials: {
      accessKeyId: session.accessKeyId,
      secretAccessKey: session.secretAccessKey,
      sessionToken: session.sessionToken,
    },
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    region: runtimeConfig.awsRegion ?? 'us-west-1',
    url: buildUrl(service.baseUrl, args.path),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return {
    Body: new Blob([await response.arrayBuffer()], {
      type: response.headers.get('content-type') ?? 'application/octet-stream',
    }),
    ContentType: response.headers.get('content-type') ?? undefined,
    VersionId: response.headers.get('x-storage-version-id'),
  };
}
