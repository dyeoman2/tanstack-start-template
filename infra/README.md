# TanStack Start Template AWS Infrastructure

This directory now contains AWS CDK infrastructure for two separate concerns:

- the existing malware-scanned S3 storage path
- disaster recovery backup and vendor-exit recovery infrastructure

## Stack Layout

### Storage / malware scan

- [infra/storage.ts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/storage.ts)
- [app.mjs](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/bin/app.mjs)
- [malware-scan-stack.cts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lib/malware-scan-stack.cts)
- [guardduty-forwarder.mjs](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lambda/guardduty-forwarder.mjs)

### Disaster recovery

- [infra/dr.ts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/dr.ts)
- [dr-backup-stack.cts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lib/dr-backup-stack.cts)
- [dr-ecs-stack.cts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lib/dr-ecs-stack.cts)
- [dr-recover-ecs.sh](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/scripts/dr-recover-ecs.sh)
- [package.json](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/package.json)
- [tsconfig.json](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/tsconfig.json)
- [cdk.json](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/cdk.json)

## DR Architecture

### DR backup stack

The backup stack provisions:

- encrypted S3 bucket for weekly Convex exports
- blocked public access
- SSL-only access
- bucket-owner-enforced object ownership
- versioning
- lifecycle to IA after 30 days
- lifecycle expiration after 90 days
- least-privilege CI IAM user for backup upload and verification

### DR ECS stack

The recovery stack provisions:

- VPC
- Aurora Serverless v2 PostgreSQL
- ECS Fargate running self-hosted Convex
- ALB routing port `3210` for the Convex API and `3211` for site/HTTP-action traffic
- Secrets Manager secrets for Aurora credentials and the Convex instance secret

This stack is intended for disaster recovery events, not day-to-day production use.

## Commands

### Storage / malware scan

Preview:

```bash
pnpm infra:preview
```

Deploy:

```bash
pnpm infra:deploy
```

### DR backup

Preview:

```bash
pnpm run infra:dr:backup:preview
```

Deploy:

```bash
pnpm run infra:dr:backup:deploy
```

### DR ECS

Set `DR_DOMAIN` first.

Preview:

```bash
pnpm run infra:dr:ecs:preview
```

Deploy:

```bash
pnpm run infra:dr:ecs:deploy
```

### All DR stacks

Preview:

```bash
pnpm run infra:dr:preview
```

Deploy:

```bash
pnpm run infra:dr:deploy
```

## Deploy-Time Environment Variables

### Storage / malware scan

The storage stack reads stage-specific values with `_DEV` / `_PROD` suffixes and falls back to the unsuffixed name.

- `AWS_REGION`
- `CONVEX_GUARDDUTY_WEBHOOK_URL_DEV`
- `CONVEX_GUARDDUTY_WEBHOOK_URL_PROD`
- `MALWARE_WEBHOOK_SHARED_SECRET_DEV`
- `MALWARE_WEBHOOK_SHARED_SECRET_PROD`
- `S3_FILES_BUCKET_NAME_DEV`
- `S3_FILES_BUCKET_NAME_PROD`

### DR backup stack

- `DR_BACKUP_S3_BUCKET`
- `DR_BACKUP_CI_USER_NAME`
- `DR_PROJECT_SLUG`

### DR ECS stack

- `DR_DOMAIN`
- `DR_BACKEND_SUBDOMAIN`
- `DR_SITE_SUBDOMAIN`
- `DR_FRONTEND_SUBDOMAIN`
- `DR_PROJECT_SLUG`
- `DR_INSTANCE_SECRET`
- `DR_CONVEX_IMAGE`
- `DR_ECS_CPU`
- `DR_ECS_MEMORY_MIB`
- `DR_AURORA_MIN_ACU`
- `DR_AURORA_MAX_ACU`

## Runtime/App Environment Contract

The application storage platform expects these runtime variables when `FILE_STORAGE_BACKEND` is `s3-primary` or `s3-mirror`:

- `FILE_STORAGE_BACKEND`
- `AWS_REGION`
- `AWS_S3_FILES_BUCKET`
- `AWS_MALWARE_WEBHOOK_SHARED_SECRET`
- `AWS_FILE_SERVE_SIGNING_SECRET`
- `CONVEX_SITE_URL`

Optional runtime tuning:

- `FILE_UPLOAD_MAX_BYTES`
- `AWS_MALWARE_SCAN_SLA_MS`
- `STORAGE_STALE_UPLOAD_TTL_MS`
- `AWS_S3_ORPHAN_CLEANUP_MIN_AGE_MS`
- `AWS_S3_ORPHAN_CLEANUP_MAX_SCAN`
- `AWS_S3_DELETE_MAX_ATTEMPTS`
- `AWS_MIRROR_RETRY_BASE_DELAY_MS`
- `AWS_MIRROR_RETRY_MAX_DELAY_MS`

## DR Recovery Inputs

The recovery script expects these AWS Secrets Manager entries by default:

- `tanstack-start-template/dr-convex-env-vars`
- `tanstack-start-template/dr-cloudflare-dns-token`
- `tanstack-start-template/dr-cloudflare-zone-id`
- `tanstack-start-template/dr-netlify-build-hook`

See the DR docs for the full operator flow:

- [Disaster Recovery Overview](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY.md)
- [Disaster Recovery Runbook](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY_RUNBOOK.md)
- [Disaster Recovery Configuration](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY_CONFIG.md)

## Notes

- The weekly DR backup workflow lives at [dr-backup-convex-s3.yml](/Users/yeoman/Desktop/tanstack/tanstack-start-template/.github/workflows/dr-backup-convex-s3.yml).
- The backup workflow validates that exported data is restorable; it is not just an artifact upload job.
- Bucket lifecycle expiration is intentionally not configured for canonical file retention in the storage path; application lifecycle deletion remains the source of truth there.
