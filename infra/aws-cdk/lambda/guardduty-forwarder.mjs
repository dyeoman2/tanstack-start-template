import crypto from 'node:crypto';

function normalizeFinding(event) {
  const detail = event?.detail ?? {};
  const s3Object = detail?.s3Object ?? {};
  const scanResultDetails = detail?.scanResultDetails ?? {};
  const rawStatus = `${scanResultDetails?.scanResultStatus ?? ''}`.toUpperCase();
  const status = rawStatus === 'NO_THREATS_FOUND' ? 'CLEAN' : 'INFECTED';
  const scannedAt = Date.parse(detail?.eventLastSeen ?? detail?.updatedAt ?? new Date().toISOString());

  return {
    bucket: s3Object.bucketName,
    findingId: detail?.scanResultDetails?.scanDetections?.[0]?.threats?.[0]?.name
      ? `${detail?.id ?? 'guardduty'}:${detail.scanResultDetails.scanDetections[0].threats[0].name}`
      : detail?.id ?? 'guardduty-finding',
    key: s3Object.objectKey,
    scannedAt: Number.isFinite(scannedAt) ? scannedAt : Date.now(),
    status,
    versionId: s3Object.versionId,
  };
}

function sign(secret, timestamp, payload) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
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

  const payload = JSON.stringify(normalized);
  const timestamp = String(Date.now());
  const signature = sign(secret, timestamp, payload);

  const response = await fetch(webhookUrl, {
    body: payload,
    headers: {
      'Content-Type': 'application/json',
      'X-Scriptflow-Signature': signature,
      'X-Scriptflow-Timestamp': timestamp,
    },
    method: 'POST',
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Convex webhook rejected GuardDuty finding: ${response.status} ${responseText}`);
  }

  return {
    forwarded: true,
  };
}
