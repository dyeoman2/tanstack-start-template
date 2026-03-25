// @ts-nocheck
const cdk = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const kms = require('aws-cdk-lib/aws-kms');
const s3 = require('aws-cdk-lib/aws-s3');

/**
 * @typedef {{
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

    const archiveKey = new kms.Key(this, 'AuditArchiveBucketKey', {
      alias: `alias/${projectSlug}-audit-archive`,
      description: 'KMS key for immutable audit archive objects',
      enableKeyRotation: true,
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
      versioned: true,
    });

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
  }
}

module.exports = {
  AuditArchiveStack,
};
