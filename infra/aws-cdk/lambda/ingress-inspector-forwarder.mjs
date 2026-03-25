import crypto from 'node:crypto';

function signWebhook(secret, timestamp, payload) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
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

function decodeS3Key(key) {
  return decodeURIComponent((key ?? '').replace(/\+/g, ' '));
}

export async function handler(event) {
  const webhookUrl =
    process.env.STORAGE_WORKER_WEBHOOK_URL ?? process.env.CONVEX_STORAGE_INSPECTION_WEBHOOK_URL;
  const secret = process.env.STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET;
  const expectedBucket = process.env.EXPECTED_BUCKET_NAME;

  if (!webhookUrl || !secret || !expectedBucket) {
    throw new Error('Ingress inspector forwarder environment is incomplete.');
  }

  const records = Array.isArray(event?.Records) ? event.Records : [];
  for (const record of records) {
    const bucket = record?.s3?.bucket?.name;
    const key = decodeS3Key(record?.s3?.object?.key);
    if (!bucket || !key || bucket !== expectedBucket || !key.startsWith('quarantine/')) {
      continue;
    }

    await postToConvex({
      payload: {
        bucket,
        key,
      },
      secret,
      webhookUrl,
    });
  }

  return {
    forwarded: records.length,
  };
}
