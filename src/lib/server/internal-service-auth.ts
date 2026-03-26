// Constant-time string comparison that does not leak length information.
// This runs in the Convex edge runtime where node:crypto is unavailable,
// so we pad to equal length and always iterate over the full input.
function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLen = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length !== rightBytes.length ? 1 : 0;
  for (let i = 0; i < maxLen; i++) {
    mismatch |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }
  return mismatch === 0;
}

export function buildInternalServiceAuthorizationHeader(secret: string) {
  return `Bearer ${secret}`;
}

export function hasValidInternalServiceAuthorization(args: {
  authorizationHeader: string | null;
  expectedSecret: string | null;
}) {
  if (!args.expectedSecret) {
    return false;
  }

  const expectedHeader = buildInternalServiceAuthorizationHeader(args.expectedSecret);
  return (
    args.authorizationHeader !== null && timingSafeEqual(args.authorizationHeader, expectedHeader)
  );
}

export function assertInternalServiceAuthorization(args: {
  authorizationHeader: string | null;
  expectedSecret: string | null;
}) {
  if (!args.expectedSecret) {
    throw new Error('Internal service shared secret is not configured.');
  }

  if (
    !hasValidInternalServiceAuthorization({
      authorizationHeader: args.authorizationHeader,
      expectedSecret: args.expectedSecret,
    })
  ) {
    throw new Error('Internal service authorization failed.');
  }
}
