import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const cloudwatch = new CloudWatchClient({});
const s3 = new S3Client({});

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function hasStuckQuarantineObject({ bucket, prefix, thresholdMs }) {
  let continuationToken;
  const cutoffTime = Date.now() - thresholdMs;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
        Prefix: prefix,
      }),
    );

    for (const object of result.Contents ?? []) {
      const lastModified = object.LastModified?.getTime();
      if (typeof lastModified === 'number' && lastModified < cutoffTime) {
        return {
          key: object.Key ?? null,
          stuck: true,
        };
      }
    }

    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return {
    key: null,
    stuck: false,
  };
}

async function publishMetric({ metricName, namespace, stage, value }) {
  await cloudwatch.send(
    new PutMetricDataCommand({
      MetricData: [
        {
          Dimensions: [{ Name: 'Stage', Value: stage }],
          MetricName: metricName,
          Timestamp: new Date(),
          Unit: 'Count',
          Value: value,
        },
      ],
      Namespace: namespace,
    }),
  );
}

export async function handler() {
  const bucket = getRequiredEnv('QUARANTINE_BUCKET_NAME');
  const metricName = getRequiredEnv('METRIC_NAME');
  const namespace = getRequiredEnv('METRIC_NAMESPACE');
  const prefix = getRequiredEnv('QUARANTINE_PREFIX');
  const stage = getRequiredEnv('STAGE');
  const stuckAgeMinutes = Number.parseInt(getRequiredEnv('STUCK_AGE_MINUTES'), 10);

  if (!Number.isFinite(stuckAgeMinutes) || stuckAgeMinutes <= 0) {
    throw new Error('STUCK_AGE_MINUTES must be a positive integer.');
  }

  const result = await hasStuckQuarantineObject({
    bucket,
    prefix,
    thresholdMs: stuckAgeMinutes * 60 * 1000,
  });
  const metricValue = result.stuck ? 1 : 0;
  await publishMetric({
    metricName,
    namespace,
    stage,
    value: metricValue,
  });

  console.log(
    JSON.stringify({
      bucket,
      metricName,
      metricValue,
      oldestStuckKey: result.key,
      prefix,
      stage,
      stuck: result.stuck,
      stuckAgeMinutes,
    }),
  );

  return {
    metricValue,
    oldestStuckKey: result.key,
    stuck: result.stuck,
  };
}
