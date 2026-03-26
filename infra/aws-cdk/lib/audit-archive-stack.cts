// @ts-nocheck
const cdk = require('aws-cdk-lib');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const cloudwatchActions = require('aws-cdk-lib/aws-cloudwatch-actions');
const iam = require('aws-cdk-lib/aws-iam');
const kms = require('aws-cdk-lib/aws-kms');
const s3 = require('aws-cdk-lib/aws-s3');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');

/**
 * @typedef {{
 *   alertEmailAddress?: string;
 *   bucketName?: string;
 *   env?: import('aws-cdk-lib').Environment;
 *   projectSlug?: string;
 *   retentionDays?: number;
 *   trustedPrincipalArn: string;
 * }} AuditArchiveStackProps
 */

class AuditArchiveStack extends cdk.Stack {
  /**
   * @param {import('constructs').Construct} scope
   * @param {string} id
   * @param {AuditArchiveStackProps & import('aws-cdk-lib').StackProps} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    const projectSlug = props.projectSlug ?? 'tanstack-start-template';
    const retentionDays = props.retentionDays ?? 2555;
    const metricNamespace = 'TanStackStart/AuditArchive';
    const alertTopic = props.alertEmailAddress
      ? new sns.Topic(this, 'AuditArchiveAlertsTopic', {
          displayName: `${projectSlug} audit archive alerts`,
          topicName: `${projectSlug}-audit-archive-alerts`,
        })
      : null;

    if (alertTopic && props.alertEmailAddress) {
      alertTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alertEmailAddress));
    }

    const archiveKey = new kms.Key(this, 'AuditArchiveBucketKey', {
      alias: `alias/${projectSlug}-audit-archive`,
      description: 'KMS key for immutable audit archive objects',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // S3 Access Logging: who accessed the immutable audit archive.
    // -----------------------------------------------------------------------
    const accessLogsBucket = new s3.Bucket(this, 'AuditArchiveAccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'ExpireOldAccessLogs',
          expiration: cdk.Duration.days(365),
        },
      ],
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const archiveBucket = new s3.Bucket(this, 'AuditArchiveBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketKeyEnabled: true,
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: archiveKey,
      enforceSSL: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.compliance(
        cdk.Duration.days(retentionDays),
      ),
      objectLockEnabled: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'audit-archive/',
      versioned: true,
    });

    // -----------------------------------------------------------------------
    // Encryption enforcement: deny puts without KMS encryption or with the
    // wrong KMS key. Belt-and-suspenders on top of the bucket encryption
    // default — ensures no misconfigured client can bypass KMS.
    // -----------------------------------------------------------------------
    archiveBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        conditions: {
          StringNotEquals: {
            's3:x-amz-server-side-encryption': 'aws:kms',
          },
        },
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        resources: [archiveBucket.arnForObjects('*')],
      }),
    );
    archiveBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        conditions: {
          StringNotEquals: {
            's3:x-amz-server-side-encryption-aws-kms-key-id': [
              archiveKey.keyArn,
              `arn:aws:kms:*:*:alias/${projectSlug}-audit-archive`,
            ],
          },
        },
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        resources: [archiveBucket.arnForObjects('*')],
      }),
    );

    const archiveRole = new iam.Role(this, 'AuditArchiveRole', {
      assumedBy: new iam.ArnPrincipal(props.trustedPrincipalArn),
      roleName: `${projectSlug}-audit-archive`,
    });

    archiveRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [archiveBucket.arnForObjects('*')],
      }),
    );
    archiveRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [archiveBucket.bucketArn],
      }),
    );
    archiveRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      }),
    );
    archiveKey.grantEncryptDecrypt(archiveRole);

    new cdk.CfnOutput(this, 'AuditArchiveBucketName', {
      value: archiveBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'AuditArchiveBucketKeyArn', {
      value: archiveKey.keyArn,
    });
    new cdk.CfnOutput(this, 'AuditArchiveRoleArn', {
      value: archiveRole.roleArn,
    });
    if (alertTopic) {
      new cdk.CfnOutput(this, 'AuditArchiveAlertsTopicArn', {
        value: alertTopic.topicArn,
      });
    }

    if (alertTopic) {
      const addEmailAlarmAction = (alarm) => {
        alarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
        return alarm;
      };

      addEmailAlarmAction(
        new cloudwatch.Alarm(this, 'ArchiveExporterDisabledAlarm', {
          alarmDescription: 'Immutable audit archive exporter is disabled.',
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 1,
          metric: new cloudwatch.Metric({
            dimensionsMap: {
              BucketName: archiveBucket.bucketName,
            },
            metricName: 'ArchiveExporterDisabled',
            namespace: metricNamespace,
            period: cdk.Duration.minutes(5),
            statistic: 'Maximum',
          }),
          threshold: 0,
        }),
      );
      addEmailAlarmAction(
        new cloudwatch.Alarm(this, 'ArchiveLagAlarm', {
          alarmDescription: 'Immutable audit archive lag is greater than zero.',
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 3,
          metric: new cloudwatch.Metric({
            dimensionsMap: {
              BucketName: archiveBucket.bucketName,
            },
            metricName: 'ArchiveLagCount',
            namespace: metricNamespace,
            period: cdk.Duration.minutes(5),
            statistic: 'Maximum',
          }),
          threshold: 0,
        }),
      );
      addEmailAlarmAction(
        new cloudwatch.Alarm(this, 'ArchiveSealExportDriftAlarm', {
          alarmDescription: 'Immutable audit archive seal/export drift detected.',
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 1,
          metric: new cloudwatch.Metric({
            dimensionsMap: {
              BucketName: archiveBucket.bucketName,
            },
            metricName: 'ArchiveSealExportDrift',
            namespace: metricNamespace,
            period: cdk.Duration.minutes(5),
            statistic: 'Maximum',
          }),
          threshold: 0,
        }),
      );
      addEmailAlarmAction(
        new cloudwatch.Alarm(this, 'ArchiveLatestSealVerifiedAlarm', {
          alarmDescription:
            'Latest immutable audit archive seal is not verified in object lock storage.',
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          evaluationPeriods: 2,
          metric: new cloudwatch.Metric({
            dimensionsMap: {
              BucketName: archiveBucket.bucketName,
            },
            metricName: 'ArchiveLatestSealVerified',
            namespace: metricNamespace,
            period: cdk.Duration.hours(1),
            statistic: 'Minimum',
          }),
          threshold: 1,
        }),
      );
    }
  }
}

module.exports = {
  AuditArchiveStack,
};
