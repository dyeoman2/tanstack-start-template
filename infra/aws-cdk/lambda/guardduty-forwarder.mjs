import crypto from 'node:crypto';

function normalizeFinding(event) {
  const detail = event?.detail ?? {};
  const s3Object = detail?.s3Object ?? {};
  const scanResultDetails = detail?.scanResultDetails ?? {};
  const rawStatus = `${scanResultDetails?.scanResultStatus ?? ''}`.toUpperCase();
  const status = rawStatus === 'NO_THREATS_FOUND' ? 'CLEAN' : 'INFECTED';
  const scannedAt = Date.parse(
    detail?.eventLastSeen ?? detail?.updatedAt ?? new Date().toISOString(),
  );

  return {
    bucket: s3Object.bucketName,
    findingId: detail?.scanResultDetails?.scanDetections?.[0]?.threats?.[0]?.name
      ? `${detail?.id ?? 'guardduty'}:${detail.scanResultDetails.scanDetections[0].threats[0].name}`
      : (detail?.id ?? 'guardduty-finding'),
    key: s3Object.objectKey,
    scannedAt: Number.isFinite(scannedAt) ? scannedAt : Date.now(),
    status,
    versionId: s3Object.versionId,
  };
}

function signWebhook(secret, timestamp, payload) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeS3CopySource(bucket, key) {
  return `${bucket}/${key.split('/').map(encodeRfc3986).join('/')}`;
}

function toAmzDate(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return `${iso.slice(0, 15)}Z`;
}

function toDateStamp(date) {
  return toAmzDate(date).slice(0, 8);
}

async function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function deriveSigningKey(secretAccessKey, dateStamp, region) {
  const dateKey = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, 's3');
  return await hmac(serviceKey, 'aws4_request');
}

function buildCanonicalHeaders(headers) {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), `${value}`.trim()])
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
}

function buildSignedHeaders(headers) {
  return Object.keys(headers)
    .map((key) => key.toLowerCase())
    .sort()
    .join(';');
}

async function createAwsAuthorizationHeader({
  bucket,
  extraHeaders = {},
  key,
  method,
  payloadHash,
}) {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('Lambda AWS execution credentials are incomplete.');
  }

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const canonicalUri = `/${key.split('/').map(encodeRfc3986).join('/')}`;
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  if (sessionToken) {
    headers['x-amz-security-token'] = sessionToken;
  }

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    buildCanonicalHeaders(headers),
    buildSignedHeaders(headers),
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = await deriveSigningKey(secretAccessKey, dateStamp, region);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    headers,
    host,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${buildSignedHeaders(
      headers,
    )}, Signature=${signature}`,
  };
}

async function s3Request(args) {
  const payloadHash = sha256Hex('');
  const signed = await createAwsAuthorizationHeader({
    bucket: args.bucket,
    extraHeaders: args.headers,
    key: args.key,
    method: args.method,
    payloadHash,
  });
  const response = await fetch(
    `https://${signed.host}/${args.key.split('/').map(encodeRfc3986).join('/')}`,
    {
      body: args.body,
      headers: {
        Authorization: signed.authorization,
        ...signed.headers,
      },
      method: args.method,
    },
  );

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`S3 ${args.method} ${args.key} failed: ${response.status} ${responseText}`);
  }

  return response;
}

async function promoteQuarantineObject({ bucket, key }) {
  const promotedKey = buildPromotedKey(key);
  if (!promotedKey) {
    throw new Error(`Cannot promote non-quarantine key: ${key}`);
  }

  const copyResponse = await s3Request({
    bucket,
    headers: {
      'x-amz-copy-source': encodeS3CopySource(bucket, key),
    },
    key: promotedKey,
    method: 'PUT',
  });
  const promotedVersionId = copyResponse.headers.get('x-amz-version-id') ?? undefined;
  await s3Request({
    bucket,
    key,
    method: 'DELETE',
  });

  return {
    promotedKey,
    promotedVersionId,
  };
}

function buildPromotedKey(key) {
  if (!key.startsWith('quarantine/')) {
    return null;
  }
  return `clean/${key.slice('quarantine/'.length)}`;
}

async function postToConvex({ payload, secret, webhookUrl }) {
  const serialized = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signWebhook(secret, timestamp, serialized);

  const response = await fetch(webhookUrl, {
    body: serialized,
    headers: {
      'Content-Type': 'application/json',
      'X-Scriptflow-Signature': signature,
      'X-Scriptflow-Timestamp': timestamp,
    },
    method: 'POST',
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Convex webhook rejected payload: ${response.status} ${responseText}`);
  }

  return await response.json();
}

export async function handler(event) {
  const webhookUrl = process.env.CONVEX_GUARDDUTY_WEBHOOK_URL;
  const secret = process.env.MALWARE_WEBHOOK_SHARED_SECRET;
  const expectedBucket = process.env.EXPECTED_BUCKET_NAME;

  if (!webhookUrl || !secret || !expectedBucket) {
    throw new Error('GuardDuty forwarder environment is incomplete.');
  }

  const normalized = normalizeFinding(event);
  if (normalized.bucket !== expectedBucket) {
    throw new Error(`Unexpected GuardDuty finding bucket: ${normalized.bucket}`);
  }

  if (normalized.status === 'CLEAN' && normalized.key.startsWith('quarantine/')) {
    try {
      const promoted = await promoteQuarantineObject({
        bucket: normalized.bucket,
        key: normalized.key,
      });
      await postToConvex({
        payload: {
          type: 'promotion_result',
          bucket: normalized.bucket,
          findingId: normalized.findingId,
          promotedBucket: normalized.bucket,
          promotedKey: promoted.promotedKey,
          promotedVersionId: promoted.promotedVersionId,
          quarantineKey: normalized.key,
          scannedAt: normalized.scannedAt,
          status: 'PROMOTED',
        },
        secret,
        webhookUrl,
      });
      return {
        forwarded: true,
        promoted: true,
      };
    } catch (error) {
      await postToConvex({
        payload: {
          type: 'promotion_result',
          bucket: normalized.bucket,
          failureReason: error instanceof Error ? error.message : 'Promotion failed.',
          findingId: normalized.findingId,
          quarantineKey: normalized.key,
          scannedAt: normalized.scannedAt,
          status: 'PROMOTION_FAILED',
        },
        secret,
        webhookUrl,
      });
      throw error;
    }
  }

  await postToConvex({
    payload: {
      ...normalized,
      type: 'guardduty_finding',
    },
    secret,
    webhookUrl,
  });

  return {
    forwarded: true,
    promoted: false,
  };
}
