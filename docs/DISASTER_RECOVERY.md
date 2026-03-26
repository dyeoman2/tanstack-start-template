# Disaster Recovery Overview

This starter now includes a two-layer disaster recovery pattern adapted from `.vendor/scriptflow`:

- **Primary recovery:** Convex Cloud, Netlify, and other managed vendors self-recover within their normal SLA.
- **Secondary backup recovery:** a weekly GitHub Actions workflow exports Convex production data to an AWS S3 bucket outside Convex.
- **Vendor-exit recovery:** a self-hosted Convex backend can be brought up on AWS ECS Fargate with Aurora Serverless v2 and restored from the latest S3 export.

## Recovery Paths

### Primary managed-vendor recovery

This remains the default incident response path:

- Convex Cloud is still the production system of record.
- Netlify remains the normal frontend host.
- Vendor-exit infrastructure is not intended to run day-to-day.

### Secondary vendor-independent backup

The weekly workflow at [db-backup.yml](/Users/yeoman/Desktop/tanstack/tanstack-start-template/.github/workflows/db-backup.yml) does all of the following:

- exports Convex production data with `pnpm exec convex export`
- uploads the archive to `s3://<bucket>/convex-backups/...`
- verifies the uploaded object exists and is plausibly sized
- starts a local self-hosted Convex backend in Docker
- pushes the starter's Convex functions and schema to that backend
- imports the exported backup to prove the artifact is restorable

This is the highest-value DR signal in the repo: the backup is not treated as valid unless the restore test passes.

### Vendor-exit / full DR failover

The AWS DR stack provisions:

- a VPC
- Aurora Serverless v2 PostgreSQL
- ECS Fargate running `ghcr.io/get-convex/convex-backend:latest`
- an ALB routing Convex API traffic to port `3210` and site/HTTP-action traffic to `3211`

The recovery runbook and script then:

- deploy the DR stack
- generate a self-hosted Convex admin key
- download and import the latest S3 backup
- deploy app code to the self-hosted backend
- apply runtime env vars and DR-specific overrides
- optionally update Cloudflare DNS
- trigger a dedicated Netlify DR frontend deploy

## File Storage Coverage

This starter supports three storage modes:

- `convex`
- `s3-primary`
- `s3-mirror`

### If production uses `s3-primary` or `s3-mirror`

DR can reuse the existing S3-backed serving path. Recovery should preserve:

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
- `STORAGE_BROKER_ACCESS_KEY_ID`
- `STORAGE_BROKER_SECRET_ACCESS_KEY`
- optional `STORAGE_BROKER_SESSION_TOKEN`
- `CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET`
- `CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET`
- `CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET`

In this configuration, file availability can be preserved independently of Convex database export/import.

If production also enables immutable audit archiving, treat that bucket as an external evidence
anchor, not as part of the DR restore path. Recovery should continue to prioritize Convex export
import plus the live S3 file buckets; the Object Lock archive is for repudiation resistance and
operator evidence, not for application reads.

### If production uses `convex`

`convex export` does **not** include Convex file blobs. In that mode:

- weekly exports prove **database restore only**
- uploaded file recovery is still a gap
- this repo does **not** claim full file-storage DR coverage

Operators must state that limitation explicitly in internal runbooks and customer-facing recovery claims.

## Infrastructure Components

### DR backup stack

Implemented in [dr-backup-stack.cts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lib/dr-backup-stack.cts).

It provisions:

- encrypted S3 backup bucket
- blocked public access
- SSL-only access
- bucket-owner-enforced ownership
- versioning
- lifecycle transition to IA after 30 days
- lifecycle expiration after 90 days
- least-privilege CI IAM user for backup uploads and verification

### DR ECS stack

Implemented in [dr-ecs-stack.cts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/lib/dr-ecs-stack.cts).

It provisions:

- VPC and security groups
- Aurora Serverless v2 PostgreSQL with SSL enforcement
- instance secret and Aurora credentials in AWS Secrets Manager
- ECS Fargate service for self-hosted Convex
- ALB outputs consumed by the recovery script

### Recovery automation

Implemented in [dr-recover-ecs.sh](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/scripts/dr-recover-ecs.sh).

This script is designed to be non-interactive by default. It supports:

- optional `SKIP_CDK_DEPLOY=true` for already-running DR infra
- Cloudflare DNS automation through Secrets Manager-stored credentials
- Netlify DR build-hook triggering through Secrets Manager
- Secrets Manager-backed runtime env replay plus DR-specific overrides

## Dedicated DR Frontend

This implementation supports two hostname strategies:

- `provider-hostnames`
  - default path
  - uses the dedicated Netlify DR site URL plus AWS-generated DR backend/site URLs
  - no Cloudflare dependency
- `custom-domain`
  - uses your own domain and derived `dr.*` hostnames
  - optional Cloudflare DNS automation

In both modes:

- the main frontend remains on Netlify
- a separate Netlify DR site exists for failover and mirrors the primary site's repo/build configuration

In `custom-domain` mode, Cloudflare can repoint:

- `dr-backend.<domain>`
- `dr-site.<domain>`
- `dr.<domain>`

The DR site should be configured ahead of time with:

- the same repo
- a dedicated build hook stored in Secrets Manager
- frontend env vars that target the DR backend/site hostnames

## Supporting Docs

- Guided setup command: `pnpm run dr:setup`
- Focused frontend-only command: `pnpm run dr:netlify:setup`
- Full cleanup commands: `pnpm run dr:backup:destroy`, `pnpm run dr:ecs:destroy`, and `pnpm run dr:destroy`
- `dr:setup` now persists the selected non-secret DR defaults into `.dr.env.local` so later `pnpm run dr:*` commands reuse the same bucket, hostname strategy, slug, and sizing without mixing them into `.env.local`.
- `dr:setup` also verifies CDK bootstrap health up front and stops early if the `CDKToolkit` bootstrap bucket is missing or drifted.
- [Disaster Recovery Runbook](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY_RUNBOOK.md)
- [Disaster Recovery Configuration](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DISASTER_RECOVERY_CONFIG.md)
- [AWS Infra README](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/README.md)
