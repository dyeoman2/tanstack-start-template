# TanStack Start Template Infrastructure

This directory contains the Infrastructure as Code (IaC) setup for the TanStack Start Template's document storage system using AWS S3.

## What This Sets Up

- **S3 Bucket**: `tanstack-start-template-documents` with proper CORS configuration for Netlify
- **IAM User**: `tanstack-start-template-storage-user` with minimal required S3 permissions
- **Access Keys**: Programmatically generated for the IAM user
- **Security**: Least-privilege access with specific S3 permissions only

## Prerequisites

1. **AWS Account** with appropriate permissions to create S3 buckets and IAM resources
2. **AWS CLI configured** with your credentials:

   ```bash
   aws configure
   ```

3. **Node.js** and **pnpm** installed

## Quick Setup

1. **Set your Netlify domain** (optional):

   ```bash
   export NETLIFY_DOMAIN=https://your-app-name.netlify.app
   ```

2. **Run the infrastructure setup**:

   ```bash
   pnpm infra:deploy
   ```

3. **Copy the generated environment variables** to your Netlify site settings

## What Happens

The script will:

1. ✅ Create S3 bucket with CORS configuration for your Netlify domain
2. ✅ Enable versioning for data protection
3. ✅ Set up lifecycle rules to manage storage costs
4. ✅ Create IAM user with minimal S3 permissions
5. ✅ Generate access keys
6. ✅ Output the exact environment variables needed for Netlify

## Environment Variables for Netlify

After running the script, add these to your Netlify site:

```bash
S3_ENDPOINT=
S3_REGION=us-west-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=tanstack-start-template-documents
S3_FORCE_PATH_STYLE=false
S3_PUBLIC_URL=https://tanstack-start-template-documents.s3.amazonaws.com
```

## Manual Setup (Alternative)

If you prefer to set up resources manually:

1. **Create S3 Bucket**:
   - Name: `tanstack-start-template-documents`
   - Region: `us-east-1`
   - Enable versioning
   - Configure CORS for your Netlify domain

2. **Create IAM User**:
   - Name: `tanstack-start-template-storage-user`
   - Attach policy with S3 permissions for the bucket

3. **Generate Access Keys** for the IAM user

## Security Notes

- The IAM user has **least-privilege access** - only the specific S3 operations needed
- Resources are scoped to the specific bucket only
- Access keys should be treated as sensitive secrets
- Consider rotating access keys regularly

## Cost Optimization

The setup includes:

- **Lifecycle rules**: Automatically delete old versions after 30 days
- **Minimal permissions**: Only necessary S3 operations allowed
- **No public access**: Files accessed via signed URLs only

## Troubleshooting

### AWS Permissions Error

Make sure your AWS user has permissions to create S3 buckets and IAM resources.

### Bucket Already Exists

The script handles existing buckets gracefully.

### CORS Issues

Update the `NETLIFY_DOMAIN` environment variable if your domain changes.

## State Management

The infrastructure state is tracked in `infra/.alchemy/state.json` (created after first run). This allows the system to know what resources exist and need to be updated or removed.
