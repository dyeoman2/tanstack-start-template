function isLoopbackHostname(hostname: string) {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

export function getLoopbackAuthOriginMismatch(
  browserOrigin: string,
  canonicalOrigin: string,
): null | {
  browserOrigin: string;
  canonicalOrigin: string;
} {
  let currentUrl: URL;
  let configuredUrl: URL;

  try {
    currentUrl = new URL(browserOrigin);
    configuredUrl = new URL(canonicalOrigin);
  } catch {
    return null;
  }

  if (!isLoopbackHostname(currentUrl.hostname) || !isLoopbackHostname(configuredUrl.hostname)) {
    return null;
  }

  if (currentUrl.origin === configuredUrl.origin) {
    return null;
  }

  return {
    browserOrigin: currentUrl.origin,
    canonicalOrigin: configuredUrl.origin,
  };
}
