function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) {
      return false;
    }
    mismatch |= leftByte ^ rightByte;
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
