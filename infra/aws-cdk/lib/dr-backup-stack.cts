// @ts-nocheck
const cdk = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const kms = require('aws-cdk-lib/aws-kms');
const s3 = require('aws-cdk-lib/aws-s3');

/**
 * @typedef {{
 *   bucketName?: string;
 *   ciUserName?: string;
 *   env?: import('aws-cdk-lib').Environment;
 *   iaTransitionDays?: number;
 *   projectSlug?: string;
 *   retentionDays?: number;
 * }} DrBackupStackProps
 */

class DrBackupStack extends cdk.Stack {
  /**
   * @param {import('constructs').Construct} scope
   * @param {string} id
   * @param {DrBackupStackProps & import('aws-cdk-lib').StackProps} [props]
   */
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const retentionDays = props.retentionDays ?? 90;
    const iaTransitionDays = props.iaTransitionDays ?? 30;
    const projectSlug = props.projectSlug ?? 'tanstack-start-template';
    const backupBucketKey = new kms.Key(this, 'ConvexDrBackupBucketKey', {
      alias: `alias/${projectSlug}-dr-backups`,
      description: 'KMS key for disaster recovery backups',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const backupBucket = new s3.Bucket(this, 'ConvexDrBackupBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: backupBucketKey,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(iaTransitionDays),
            },
          ],
        },
        {
          id: 'ExpireOldBackups',
          expiration: cdk.Duration.days(retentionDays),
        },
      ],
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
    });

    const ciUser = new iam.User(this, 'DrBackupCiUser', {
      userName: props.ciUserName ?? `${projectSlug}-dr-backup-ci-user`,
    });

    ciUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
        resources: [backupBucket.bucketArn, backupBucket.arnForObjects('*')],
      }),
    );
    backupBucketKey.grantEncryptDecrypt(ciUser);

    new cdk.CfnOutput(this, 'DrBackupBucketName', {
      value: backupBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'DrBackupBucketKeyArn', {
      value: backupBucketKey.keyArn,
    });
    new cdk.CfnOutput(this, 'DrBackupCiUserName', {
      value: ciUser.userName,
    });
  }
}

module.exports = {
  DrBackupStack,
};
