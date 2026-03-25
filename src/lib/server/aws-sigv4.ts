type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
};

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function toAmzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return `${iso.slice(0, 15)}Z`;
}

function toDateStamp(date: Date) {
  return toAmzDate(date).slice(0, 8);
}

async function hmac(key: Uint8Array | string, value: string) {
  const rawKey = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)),
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

async function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, 'execute-api');
  return await hmac(serviceKey, 'aws4_request');
}

function buildCanonicalHeaders(headers: Record<string, string>) {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
}

function buildSignedHeaders(headers: Record<string, string>) {
  return Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort()
    .join(';');
}

function buildCanonicalQueryString(url: URL) {
  return [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey),
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

export async function fetchWithAwsSigv4(args: {
  body?: string;
  credentials: AwsCredentials;
  headers?: Record<string, string>;
  method: 'GET' | 'POST';
  region: string;
  url: string;
}) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const target = new URL(args.url);
  const payload = args.body ?? '';
  const payloadHash = await sha256Hex(payload);
  const baseHeaders: Record<string, string> = {
    host: target.host,
    'x-amz-date': amzDate,
    ...args.headers,
  };
  if (args.credentials.sessionToken) {
    baseHeaders['x-amz-security-token'] = args.credentials.sessionToken;
  }
  const canonicalHeaders = buildCanonicalHeaders(baseHeaders);
  const signedHeaders = buildSignedHeaders(baseHeaders);
  const canonicalRequest = [
    args.method,
    target.pathname,
    buildCanonicalQueryString(target),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${args.region}/execute-api/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = Array.from(
    await hmac(
      await deriveSigningKey(args.credentials.secretAccessKey, dateStamp, args.region),
      stringToSign,
    ),
    (part) => part.toString(16).padStart(2, '0'),
  ).join('');
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${args.credentials.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  return await fetch(target, {
    body: payload || undefined,
    headers: {
      ...Object.fromEntries(Object.entries(baseHeaders).map(([key, value]) => [key, value])),
      Authorization: authorization,
    },
    method: args.method,
  });
}
