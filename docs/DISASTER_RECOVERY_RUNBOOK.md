# Disaster Recovery Runbook

## Prerequisites

- AWS credentials with permission to deploy CDK stacks, read/write Secrets Manager, read S3 backups, and manage ECS
- Docker installed for local restore validation and preferred admin-key generation
- `pnpm`, `jq`, `curl`, and the AWS CLI installed
- a dedicated Netlify DR frontend site with a build hook
- Cloudflare API credentials with DNS edit access if DNS automation is desired

## Required AWS Secrets Manager Secrets

- `<project-slug>/dr-convex-env-vars`
- `<project-slug>/dr-cloudflare-dns-token`
- `<project-slug>/dr-cloudflare-zone-id`
- `<project-slug>/dr-netlify-build-hook`

`<project-slug>` defaults to `tanstack-start-template`.

## Deploy Backup Infrastructure

Preview:

```bash
pnpm run infra:dr:backup:preview
```

Deploy:

```bash
pnpm run infra:dr:backup:deploy
```

Outputs:

- `DrBackupBucketName`
- `DrBackupCiUserName`

## Deploy DR ECS Infrastructure

Set at minimum:

```bash
export DR_DOMAIN=example.com
```

Preview:

```bash
pnpm run infra:dr:ecs:preview
```

Deploy:

```bash
pnpm run infra:dr:ecs:deploy
```

The DR ECS stack is only synthesized when `DR_DOMAIN` is set.

## Refresh the DR Runtime Env Secret

Keep the DR env secret synchronized with production Convex env vars:

```bash
pnpm exec convex env list --prod | jq -Rs '
  split("\n") | map(select(length > 0)) |
  map(capture("^(?<key>[^=]+)=(?<value>.*)$")) | from_entries
' | aws secretsmanager put-secret-value \
  --secret-id tanstack-start-template/dr-convex-env-vars \
  --secret-string file:///dev/stdin
```

If production uses `s3-primary` or `s3-mirror`, make sure the resulting secret includes:

- `FILE_STORAGE_BACKEND`
- `AWS_S3_FILES_BUCKET`
- `CONVEX_SITE_URL`
- `AWS_FILE_SERVE_SIGNING_SECRET`

## Trigger a Manual Backup

Use the GitHub Actions workflow:

- workflow: `Weekly DR Backup (Convex -> S3)`
- trigger: `workflow_dispatch`

The workflow should not be considered successful unless export, upload, deploy-test, and restore-test all pass.

## Run Full Recovery

Set required env vars:

```bash
export DR_DOMAIN=example.com
export DR_BACKUP_S3_BUCKET=your-dr-backup-bucket
```

Recommended optional env vars:

```bash
export DR_FRONTEND_CNAME_TARGET=your-dr-site.netlify.app
export BETTER_AUTH_SECRET=your-production-better-auth-secret
export JWKS='{"keys":[...]}'
```

Run recovery:

```bash
./infra/aws-cdk/scripts/dr-recover-ecs.sh
```

## What the Recovery Script Does

1. Deploys the ECS DR stack unless `SKIP_CDK_DEPLOY=true`
2. Reads CloudFormation outputs and the self-hosted instance secret
3. Waits for ECS and ALB health
4. Generates a self-hosted Convex admin key
5. Sets minimum env vars and runs `pnpm exec convex deploy`
6. Downloads the newest S3 backup and imports it
7. Replays runtime env vars from Secrets Manager and applies DR overrides
8. Updates Cloudflare CNAMEs for backend, site, and frontend
9. Triggers the dedicated Netlify DR build hook
10. Verifies backend health directly and, when possible, through DR DNS

## Post-Recovery Checks

- Confirm `${DR_BACKUP_S3_BUCKET}` contains recent `convex-backups/` objects
- Confirm the backend responds at `https://dr-backend.<domain>/version`
- Confirm the Convex site host responds at `https://dr-site.<domain>`
- Confirm the Netlify DR site builds successfully
- Confirm login and basic data access from the DR frontend
- Confirm file access behavior matches the active storage mode

## Known Limitations

- If production uses `FILE_STORAGE_BACKEND=convex`, uploaded Convex blobs are not covered by `convex export`
- The script assumes Cloudflare for automated DNS updates; without those secrets, DNS repointing is manual
- The script can trigger a Netlify DR build, but the DR site must already exist and be preconfigured
- Return-to-primary reconciliation is operationally separate and is not automated in this repo
