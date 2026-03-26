// @ts-nocheck
const cdk = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const kms = require('aws-cdk-lib/aws-kms');
const s3 = require('aws-cdk-lib/aws-s3');

/**
 * @typedef {{
 *   bucketName?: string;
 *   env?: import('aws-cdk-lib').Environment;
 *   githubRepo?: string;
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

    // -----------------------------------------------------------------------
    // S3 Access Logging: who accessed the DR backup bucket.
    // -----------------------------------------------------------------------
    const accessLogsBucket = new s3.Bucket(this, 'DrBackupAccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'ExpireOldAccessLogs',
          expiration: cdk.Duration.days(90),
        },
      ],
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
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
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'dr-backup/',
      versioned: true,
    });

    // -----------------------------------------------------------------------
    // GitHub OIDC: federated identity for GitHub Actions (no long-lived keys).
    // -----------------------------------------------------------------------
    const githubRepo = props.githubRepo;
    if (githubRepo) {
      const oidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
        thumbprints: [
          '6938fd4d98bab03faadb97b34396831e3780aea1',
          '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
        ],
      });

      const oidcTrustConditions = {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${githubRepo}:*`,
        },
      };

      const backupRole = new iam.Role(this, 'DrBackupOidcRole', {
        assumedBy: new iam.WebIdentityPrincipal(
          oidcProvider.openIdConnectProviderArn,
          oidcTrustConditions,
        ),
        description: 'GitHub Actions role for DR backup workflows',
      });

      backupRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
          resources: [backupBucket.bucketArn, backupBucket.arnForObjects('*')],
        }),
      );
      backupBucketKey.grantEncryptDecrypt(backupRole);

      const recoveryRole = new iam.Role(this, 'DrRecoveryOidcRole', {
        assumedBy: new iam.WebIdentityPrincipal(
          oidcProvider.openIdConnectProviderArn,
          oidcTrustConditions,
        ),
        description: 'GitHub Actions role for DR recovery workflows',
      });

      recoveryRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
          resources: [backupBucket.bucketArn, backupBucket.arnForObjects('*')],
        }),
      );
      recoveryRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: ['*'],
        }),
      );
      recoveryRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ['cloudformation:*'],
          resources: [`arn:aws:cloudformation:*:*:stack/${projectSlug}-dr-*/*`],
        }),
      );
      recoveryRole.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'ecs:*',
            'ec2:Describe*',
            'elasticloadbalancing:*',
            'rds:*',
            'secretsmanager:*',
            'logs:*',
          ],
          resources: ['*'],
        }),
      );
      backupBucketKey.grantEncryptDecrypt(recoveryRole);

      new cdk.CfnOutput(this, 'DrBackupOidcRoleArn', {
        value: backupRole.roleArn,
      });
      new cdk.CfnOutput(this, 'DrRecoveryOidcRoleArn', {
        value: recoveryRole.roleArn,
      });
    }

    new cdk.CfnOutput(this, 'DrBackupBucketName', {
      value: backupBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'DrBackupBucketKeyArn', {
      value: backupBucketKey.keyArn,
    });
  }
}

module.exports = {
  DrBackupStack,
};
