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

For guided DR setup across AWS, GitHub, Convex, and Netlify:

```bash
pnpm run dr:setup
```

### Storage / malware scan

Preview:

```bash
pnpm run storage:preview:dev
pnpm run storage:preview:prod
```

Deploy:

```bash
pnpm run storage:deploy:dev
pnpm run storage:deploy:prod
```

Legacy `s3-primary` clean-prefix backfill:

```bash
pnpm run storage:backfill:clean-prefixes
pnpm run storage:backfill:clean-prefixes -- --apply
pnpm run storage:backfill:clean-prefixes -- --apply --prod
pnpm run storage:backfill:mirror-prefixes
pnpm run storage:backfill:mirror-prefixes -- --apply
pnpm run storage:backfill:mirror-prefixes -- --apply --prod
```

Destroy:

```bash
pnpm run storage:destroy:dev
pnpm run storage:destroy:prod
```

### DR backup

Preview:

```bash
pnpm run dr:backup:preview
```

Deploy:

```bash
pnpm run dr:backup:deploy
```

Destroy:

```bash
pnpm run dr:backup:destroy
```

### DR ECS

Set `AWS_DR_DOMAIN` first.

Preview:

```bash
pnpm run dr:ecs:preview
```

Deploy:

```bash
pnpm run dr:ecs:deploy
```

Destroy:

```bash
pnpm run dr:ecs:destroy
```

### All DR stacks

Preview:

```bash
pnpm run dr:preview
```

Deploy:

```bash
pnpm run dr:deploy
```

Destroy:

```bash
pnpm run dr:destroy
```

## Deploy-Time Environment Variables

### Storage / malware scan

The storage wrapper takes an explicit stage via `--stage dev|prod`, then derives the storage stack inputs from the runtime env already configured for that target.

- `AWS_REGION`
- `CONVEX_SITE_URL`
- `AWS_S3_FILES_BUCKET`
- `AWS_MALWARE_WEBHOOK_SHARED_SECRET`
- optional `AWS_PROFILE`

Legacy-prefix access is no longer a deploy-time toggle. Run both backfills to zero before the final app + infra redeploy:

- `pnpm run storage:backfill:clean-prefixes -- --apply`
- `pnpm run storage:backfill:mirror-prefixes -- --apply`

Those are transformed into the CDK app inputs:

- `AWS_CONVEX_GUARDDUTY_WEBHOOK_URL`
- `AWS_MALWARE_WEBHOOK_SHARED_SECRET`
- `AWS_S3_FILES_BUCKET_NAME`
- `STORAGE_STAGE`

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
- `AWS_DR_ENV_SECRET_NAME`
- `AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME`
- `AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME`
- `AWS_DR_NETLIFY_HOOK_SECRET_NAME`

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

- `tanstack-start-template-dr-convex-admin-key-secret`
- `tanstack-start-template-dr-convex-env-secret`
- `tanstack-start-template-dr-cloudflare-dns-token-secret`
- `tanstack-start-template-dr-cloudflare-zone-id-secret`
- `tanstack-start-template-dr-netlify-build-hook-secret`
- `tanstack-start-template-dr-netlify-frontend-cname-target-secret`

See the DR docs for the full operator flow:

- [Disaster Recovery Overview](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY.md)
- [Disaster Recovery Runbook](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY_RUNBOOK.md)
- [Disaster Recovery Configuration](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY_CONFIG.md)

## Notes

- The weekly DR backup workflow lives at [db-backup.yml](/Users/yeoman/Desktop/tanstack/tanstack-start-template/.github/workflows/db-backup.yml).
- The backup workflow validates that exported data is restorable; it is not just an artifact upload job.
- Bucket lifecycle expiration is intentionally not configured for canonical file retention in the storage path; application lifecycle deletion remains the source of truth there.
