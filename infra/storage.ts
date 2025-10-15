#!/usr/bin/env tsx

/**
 * Infrastructure as Code for TanStack Start Template Storage
 *
 * This script sets up the AWS S3 bucket and IAM resources needed for document storage.
 * Run with: pnpm infra:deploy
 */

import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  IAMClient,
  PutUserPolicyCommand,
} from '@aws-sdk/client-iam';
import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// Configuration
const REGION = 'us-west-1';
const BUCKET_NAME = `tanstack-start-template-documents-${REGION}`;
const IAM_USER_NAME = `tanstack-start-template-storage-user-${REGION}`;

const NETLIFY_DOMAIN = process.env.NETLIFY_DOMAIN || 'https://tanstack-start-template.netlify.app';

// Initialize AWS clients
const s3Client = new S3Client({ region: REGION });
const iamClient = new IAMClient({ region: REGION });

async function createS3Bucket() {
  console.log('📦 Creating S3 bucket...');

  try {
    // Create bucket
    await s3Client.send(
      new CreateBucketCommand({
        Bucket: BUCKET_NAME,
      }),
    );
    console.log(`✅ Created bucket: ${BUCKET_NAME}`);

    // Configure CORS
    await s3Client.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ['*'],
              AllowedMethods: ['GET', 'PUT', 'POST'],
              AllowedOrigins: [
                'http://localhost:3000', // Local development
                NETLIFY_DOMAIN, // Production domain
                'https://deploy-preview-*--tanstack-start-template.netlify.app', // Netlify preview deployments
                'https://*--tanstack-start-template.netlify.app', // All Netlify subdomains for this site
              ],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      }),
    );
    console.log('✅ Configured CORS policy');

    // Enable versioning
    await s3Client.send(
      new PutBucketVersioningCommand({
        Bucket: BUCKET_NAME,
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      }),
    );
    console.log('✅ Enabled versioning');

    // Skip lifecycle rules for now - can be configured manually if needed
    console.log('ℹ️  Skipping lifecycle rules (can configure manually in AWS console)');
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'BucketAlreadyOwnedByYou') {
      console.log('ℹ️  Bucket already exists');
    } else {
      throw error;
    }
  }
}

async function createIAMUser() {
  console.log('👤 Creating IAM user...');

  try {
    // Create user
    await iamClient.send(
      new CreateUserCommand({
        UserName: IAM_USER_NAME,
      }),
    );
    console.log(`✅ Created IAM user: ${IAM_USER_NAME}`);

    // Attach policy
    const policyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
          Resource: [`arn:aws:s3:::${BUCKET_NAME}`, `arn:aws:s3:::${BUCKET_NAME}/*`],
        },
      ],
    };

    await iamClient.send(
      new PutUserPolicyCommand({
        UserName: IAM_USER_NAME,
        PolicyName: 'S3StorageAccess',
        PolicyDocument: JSON.stringify(policyDocument),
      }),
    );
    console.log('✅ Attached S3 access policy');

    // Create access keys
    const accessKeyResponse = await iamClient.send(
      new CreateAccessKeyCommand({
        UserName: IAM_USER_NAME,
      }),
    );

    const accessKeyId = accessKeyResponse.AccessKey?.AccessKeyId;
    const secretAccessKey = accessKeyResponse.AccessKey?.SecretAccessKey;

    console.log('✅ Created access keys');

    return { accessKeyId, secretAccessKey };
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'EntityAlreadyExistsException') {
      console.log('ℹ️  IAM user already exists');

      // Try to create access keys for existing user
      try {
        const accessKeyResponse = await iamClient.send(
          new CreateAccessKeyCommand({
            UserName: IAM_USER_NAME,
          }),
        );
        return {
          accessKeyId: accessKeyResponse.AccessKey?.AccessKeyId,
          secretAccessKey: accessKeyResponse.AccessKey?.SecretAccessKey,
        };
      } catch {
        console.log('⚠️  Could not create access keys for existing user');
        console.log('   You may need to create them manually in the AWS console');
        return { accessKeyId: null, secretAccessKey: null };
      }
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log('🚀 Setting up TanStack Start Template storage infrastructure...\n');

  try {
    // Create S3 bucket
    await createS3Bucket();

    // Create IAM user and access keys
    await createIAMUser();
  } catch (error) {
    console.error('❌ Failed to set up infrastructure:', error);
    process.exit(1);
  }
}

main();
