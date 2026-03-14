const DEFAULT_LOCAL_PORTS = [3000, 3001, 3002, 4173, 4174, 5173, 5174] as const;
const LOCAL_BASE_URL_PROBE_TIMEOUT_MS = 1500;

function buildCandidateBaseUrls() {
  return DEFAULT_LOCAL_PORTS.map((port) => `http://127.0.0.1:${port}`);
}

async function isReachableLocalBaseUrl(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(LOCAL_BASE_URL_PROBE_TIMEOUT_MS),
    });

    return response.status < 500;
  } catch {
    return false;
  }
}

export async function findReachableLocalBaseUrls(explicitBaseUrl?: string): Promise<string[]> {
  if (explicitBaseUrl) {
    return [explicitBaseUrl];
  }

  const reachableCandidates: string[] = [];
  for (const candidate of buildCandidateBaseUrls()) {
    if (await isReachableLocalBaseUrl(candidate)) {
      reachableCandidates.push(candidate);
    }
  }

  if (reachableCandidates.length === 0) {
    throw new Error(
      'Could not detect a local app URL. Start the app or pass --base-url explicitly.',
    );
  }

  return reachableCandidates;
}

export async function resolveLocalBaseUrl(explicitBaseUrl?: string): Promise<string> {
  const [baseUrl] = await findReachableLocalBaseUrls(explicitBaseUrl);
  return baseUrl;
}
