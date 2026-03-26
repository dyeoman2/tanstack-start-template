# TanStack Start Template AWS Infrastructure

This directory now contains AWS CDK infrastructure for two separate concerns:

- the existing malware-scanned S3 storage path
- immutable audit archiving
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

### Immutable audit archive

- [app.mjs](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/bin/app.mjs)
- [audit-archive-stack.cts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lib/audit-archive-stack.cts)

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

### Audit archive stack

The archive stack provisions:

- an Object Lock S3 bucket in compliance mode
- a dedicated KMS key
- a dedicated write role trusted by one explicit principal ARN
- optional SNS-backed CloudWatch alarms when `AWS_STORAGE_ALERT_EMAIL` is configured
- blocked public access, SSL-only access, bucket-owner-enforced ownership, and versioning

## Commands

For guided DR setup across AWS, GitHub, Convex, and Netlify:

```bash
pnpm run dr:setup
```

For guided immutable audit archive setup:

```bash
pnpm run audit-archive:setup -- --prod
```

Preview / deploy directly from the current `.env.prod` operator state:

```bash
pnpm run audit-archive:preview
pnpm run audit-archive:deploy
```

Destroy:

```bash
pnpm run audit-archive:destroy
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

Destroy:

```bash
pnpm run aws:destroy:all
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
- `AWS_S3_QUARANTINE_BUCKET`
- `AWS_S3_CLEAN_BUCKET`
- `AWS_S3_REJECTED_BUCKET`
- `AWS_S3_MIRROR_BUCKET`
- `AWS_FILE_SERVE_SIGNING_SECRET`
- `CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET`
- `CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET`
- `CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET`
- optional `AWS_STORAGE_ALERT_EMAIL`
- optional `AWS_PROFILE`

Those are transformed into the CDK app inputs:

- `AWS_CONVEX_STORAGE_CALLBACK_BASE_URL`
- `AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET`
- `AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET`
- `AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET`
- `AWS_FILE_SERVE_SIGNING_SECRET`
- `AWS_STORAGE_ALERT_EMAIL` when you want production SNS email alerts
- `AWS_S3_QUARANTINE_BUCKET_NAME`
- `AWS_S3_CLEAN_BUCKET_NAME`
- `AWS_S3_REJECTED_BUCKET_NAME`
- `AWS_S3_MIRROR_BUCKET_NAME`
- `STORAGE_STAGE`

The storage stack creates dedicated broker and worker runtime roles in AWS and scopes the
per-capability storage role trust policies to those runtime roles.

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

### Audit archive stack

- `AWS_AUDIT_ARCHIVE_BUCKET_NAME`
- `AWS_AUDIT_ARCHIVE_TRUSTED_PRINCIPAL_ARN`
- optional `AWS_AUDIT_ARCHIVE_RETENTION_DAYS`

The guided setup flow persists those deploy-time values into `.env.prod`, then captures these stack outputs after deploy when available:

- `AuditArchiveBucketName`
- `AuditArchiveBucketKeyArn`
- `AuditArchiveRoleArn`

For S3-backed production, immutable archive readiness is enforced as a release gate through
`pnpm run deploy:doctor -- --prod`. The gate requires complete runtime wiring plus a verified
latest sealed segment in immutable storage.

## Runtime/App Environment Contract

The application storage platform expects these runtime variables when `FILE_STORAGE_BACKEND` is `s3-primary` or `s3-mirror`:

- `FILE_STORAGE_BACKEND`
- `AWS_REGION`
- `AWS_S3_QUARANTINE_BUCKET`
- `AWS_S3_CLEAN_BUCKET`
- `AWS_S3_REJECTED_BUCKET`
- `AWS_S3_MIRROR_BUCKET`
- `AWS_S3_QUARANTINE_KMS_KEY_ARN`
- `AWS_S3_CLEAN_KMS_KEY_ARN`
- `AWS_S3_REJECTED_KMS_KEY_ARN`
- `AWS_S3_MIRROR_KMS_KEY_ARN`
- `AWS_FILE_SERVE_SIGNING_SECRET`
- `STORAGE_BROKER_URL`
- `STORAGE_BROKER_EDGE_ASSERTION_SECRET`
- `STORAGE_BROKER_CONTROL_ASSERTION_SECRET`
- `CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET`
- `CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET`
- `CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET`
- `CONVEX_SITE_URL`

When immutable audit archiving is enabled, the application also expects:

- `AWS_AUDIT_ARCHIVE_BUCKET`
- `AWS_AUDIT_ARCHIVE_KMS_KEY_ARN`
- `AWS_AUDIT_ARCHIVE_ROLE_ARN`
- optional `AWS_AUDIT_ARCHIVE_PREFIX`

`pnpm run setup:prod` now orchestrates:

- guided production storage setup
- optional immutable audit archive setup
- optional disaster recovery setup

and carries forward the child-script readiness/warning summaries so the top-level result reflects whether those AWS surfaces are actually configured.

Repo-managed teardown uses the matching destroy scripts and includes legacy storage bucket cleanup for older `*-files-bucket` layouts that may survive stack deletion.

Shared/account-level AWS resources remain out of scope for repo teardown, including:

- `CDKToolkit`
- the CDK asset bucket
- AWS service-linked roles
- unrelated account resources created outside this repo

Successful repo-managed teardown means the repo leaves behind no AWS resources whose names still contain `tanstack-start-template`. The acceptance check is:

```bash
pnpm run aws:destroy:all -- --yes

aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[?contains(StackName, 'tanstack-start-template')].[StackName,StackStatus]" --output json
aws s3api list-buckets --query "Buckets[?contains(Name, 'tanstack-start-template')].[Name]" --output json
aws secretsmanager list-secrets --query "SecretList[?contains(Name, 'tanstack-start-template')].[Name]" --output json
aws iam list-roles --query "Roles[?contains(RoleName, 'tanstack-start-template')].[RoleName]" --output json
```

Expected result after a successful repo-managed teardown:

```json
[]
[]
[]
[]
```

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
- [Storage IAM Report](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/generated/storage-iam-report.md)

## Notes

- The weekly DR backup workflow lives at [db-backup.yml](/Users/yeoman/Desktop/tanstack/tanstack-start-template/.github/workflows/db-backup.yml).
- The backup workflow validates that exported data is restorable; it is not just an artifact upload job.
- Bucket lifecycle expiration is intentionally not configured for canonical file retention in the storage path; application lifecycle deletion remains the source of truth there.
- The immutable audit archive is an external evidence anchor for sealed ledger segments. It is not the primary audit query path for the app.
