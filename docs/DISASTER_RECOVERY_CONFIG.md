# Disaster Recovery Configuration

## GitHub Actions Secrets

Required for [dr-backup-convex-s3.yml](/Users/yeoman/Desktop/tanstack/tanstack-start-template/.github/workflows/dr-backup-convex-s3.yml):

- `CONVEX_DEPLOY_KEY`
- `AWS_DR_BACKUP_ACCESS_KEY_ID`
- `AWS_DR_BACKUP_SECRET_ACCESS_KEY`
- `AWS_DR_BACKUP_REGION`
- `AWS_DR_BACKUP_S3_BUCKET`

Recommended for local self-hosted deploy validation inside the workflow:

- `DR_TEST_APP_NAME`
- `DR_TEST_APP_URL`
- `DR_TEST_BETTER_AUTH_SECRET`
- `DR_TEST_BETTER_AUTH_URL`
- `DR_TEST_CONVEX_SITE_URL`
- `DR_TEST_JWKS`

If the recommended test secrets are omitted, the workflow falls back to local development-style defaults where possible.

## CDK Deploy-Time Environment Variables

### Shared

- `AWS_REGION`
- `CDK_DEFAULT_ACCOUNT`
- `CDK_DEFAULT_REGION`

### Existing malware scan stacks

- `CONVEX_GUARDDUTY_WEBHOOK_URL_DEV`
- `CONVEX_GUARDDUTY_WEBHOOK_URL_PROD`
- `MALWARE_WEBHOOK_SHARED_SECRET_DEV`
- `MALWARE_WEBHOOK_SHARED_SECRET_PROD`
- `S3_FILES_BUCKET_NAME_DEV`
- `S3_FILES_BUCKET_NAME_PROD`

### DR backup stack

- `AWS_DR_BACKUP_S3_BUCKET`
- `AWS_DR_BACKUP_CI_USER_NAME`
- `AWS_DR_PROJECT_SLUG`

### DR ECS stack

- `AWS_DR_DOMAIN`
- `AWS_DR_STACK_NAME`
- `AWS_DR_BACKEND_SUBDOMAIN`
- `AWS_DR_SITE_SUBDOMAIN`
- `AWS_DR_FRONTEND_SUBDOMAIN`
- `AWS_DR_FRONTEND_CNAME_TARGET`
- `AWS_DR_PROJECT_SLUG`
- `AWS_DR_INSTANCE_SECRET`
- `AWS_DR_CONVEX_IMAGE`
- `AWS_DR_ECS_CPU`
- `AWS_DR_ECS_MEMORY_MIB`
- `AWS_DR_AURORA_MIN_ACU`
- `AWS_DR_AURORA_MAX_ACU`

## AWS Secrets Manager Secrets

Expected by [dr-recover-ecs.sh](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/scripts/dr-recover-ecs.sh):

- `tanstack-start-template/dr-convex-env-vars`
- `tanstack-start-template/dr-cloudflare-dns-token`
- `tanstack-start-template/dr-cloudflare-zone-id`
- `tanstack-start-template/dr-netlify-build-hook`

If `AWS_DR_PROJECT_SLUG` is changed, the secret names change to match that slug.

Optional override env vars for non-default secret names:

- `AWS_DR_ENV_SECRET_NAME`
- `AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME`
- `AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME`
- `AWS_DR_NETLIFY_HOOK_SECRET_NAME`

## Runtime Variables Replayed During Recovery

The recovery script replays production Convex env vars from the DR env secret, then overrides the values that must change in DR.

At minimum, operators should expect the DR path to set or override:

- `APP_NAME`
- `APP_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `JWKS`
- `CONVEX_SITE_URL`

If using S3-backed storage:

- `FILE_STORAGE_BACKEND`
- `AWS_S3_FILES_BUCKET`
- `AWS_FILE_SERVE_SIGNING_SECRET`

## Dedicated DR Frontend Requirements

The Netlify DR site should be configured ahead of time with:

- the same repository
- a dedicated build hook URL stored in Secrets Manager
- frontend env vars that point to the DR Convex backend and site hosts
- a DNS target value exposed to the recovery script via `AWS_DR_FRONTEND_CNAME_TARGET`

This repo automates the build hook trigger and Cloudflare DNS repointing, but it does not create the Netlify site for you.
