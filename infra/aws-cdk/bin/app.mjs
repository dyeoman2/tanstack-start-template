import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const cdk = require('aws-cdk-lib');
const { MalwareScanStack } = require(path.join('..', 'lib', 'malware-scan-stack.cts'));

function readEnv(name, stage) {
  return process.env[`${name}_${stage}`] || process.env[name] || '';
}

function createStageConfig(stage) {
  const upperStage = stage.toUpperCase();
  return {
    bucketName: readEnv('S3_FILES_BUCKET_NAME', upperStage),
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-1',
    },
    malwareWebhookSharedSecret: readEnv('MALWARE_WEBHOOK_SHARED_SECRET', upperStage),
    stage,
    webhookUrl: readEnv('CONVEX_GUARDDUTY_WEBHOOK_URL', upperStage),
  };
}

const app = new cdk.App();

for (const stage of ['dev', 'prod']) {
  const config = createStageConfig(stage);
  if (!config.bucketName || !config.webhookUrl || !config.malwareWebhookSharedSecret) {
    continue;
  }

  new MalwareScanStack(app, `TanStackStartMalwareScan-${stage}`, config);
}
