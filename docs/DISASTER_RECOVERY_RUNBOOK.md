# Disaster Recovery Runbook

## Prerequisites

- AWS credentials with permission to deploy CDK stacks, read/write Secrets Manager, read S3 backups, and manage ECS
- Docker installed for local restore validation and preferred admin-key generation
- `pnpm`, `jq`, `curl`, and the AWS CLI installed
- a dedicated Netlify DR frontend site with a build hook
- Cloudflare API credentials with DNS edit access if DNS automation is desired

## Guided Setup

For the smoothest first-time setup, run:

```bash
pnpm run dr:setup
```

The guided script discovers the current environment, configures the DR stacks, syncs the runtime secret from Convex production env vars, updates GitHub Actions secrets, and attempts to create or validate the dedicated Netlify DR site and build hook before falling back to manual remediation steps.

It also:

- persists the chosen non-secret DR defaults into `.dr.env.local` so later `pnpm run dr:*` commands reuse the same project slug, bucket, hostname strategy, and ECS sizing
- verifies CDK bootstrap health up front and stops early if the `CDKToolkit` bootstrap bucket is missing or drifted

`dr:setup` now supports two DR hostname strategies:

- `provider-hostnames`
  - default path
  - uses the Netlify DR site URL and AWS-generated DR backend/site URLs
  - does not require Cloudflare or a custom domain
- `custom-domain`
  - advanced path
  - derives `dr.*`, `dr-backend.*`, and `dr-site.*` from your domain
  - supports Cloudflare DNS cutover automation

If the AWS DR stacks already exist and you only need to finish or repair the frontend failover lane, run:

```bash
pnpm run dr:netlify:setup
```

That focused command reuses the saved DR defaults from `.dr.env.local`, creates or resolves the dedicated DR Netlify site, mirrors the primary Netlify site's repo/build configuration, sets the required Netlify runtime env, and updates the Netlify build-hook and frontend-hostname secrets in AWS Secrets Manager without rerunning the full backup or ECS setup flow.

## Destroy and Reset

To fully clean up DR and get back to a rerunnable-from-scratch state, use:

```bash
pnpm run dr:backup:destroy
pnpm run dr:ecs:destroy
pnpm run dr:destroy
```

Those commands remove more than the CloudFormation stacks:

- `dr:backup:destroy` deletes backup IAM access keys and clears the backup bucket before deleting the backup stack
- `dr:ecs:destroy` deletes the ECS stack and then removes manual Aurora snapshots left by the snapshot removal policy
- `dr:destroy` also deletes the DR Netlify site, DR-specific GitHub Actions secrets, DR-specific Secrets Manager secrets, and `.dr.env.local`

## Required AWS Secrets Manager Secrets

- `<project-slug>-dr-convex-admin-key-secret`
- `<project-slug>-dr-convex-env-secret`
- `<project-slug>-dr-cloudflare-dns-token-secret`
- `<project-slug>-dr-cloudflare-zone-id-secret`
- `<project-slug>-dr-netlify-build-hook-secret`
- `<project-slug>-dr-netlify-frontend-cname-target-secret`

`<project-slug>` defaults to `tanstack-start-template`.

## Deploy Backup Infrastructure

Preview:

```bash
pnpm run dr:backup:preview
```

Deploy:

```bash
pnpm run dr:backup:deploy
```

Outputs:

- `DrBackupBucketName`
- `DrBackupCiUserName`

## Deploy DR ECS Infrastructure

For `custom-domain` mode, set at minimum:

```bash
export AWS_DR_DOMAIN=example.com
```

Preview:

```bash
pnpm run dr:ecs:preview
```

Deploy:

```bash
pnpm run dr:ecs:deploy
```

The DR ECS stack is synthesized when either:

- `AWS_DR_HOSTNAME_STRATEGY=provider-hostnames`, or
- `AWS_DR_HOSTNAME_STRATEGY=custom-domain` and `AWS_DR_DOMAIN` is set

## Refresh the DR Runtime Env Secret

Keep the DR env secret synchronized with production Convex env vars:

```bash
pnpm run dr:sync-env
```

Optional overrides:

```bash
AWS_DR_PROJECT_SLUG=your-project pnpm run dr:sync-env
AWS_DR_ENV_SECRET_NAME=custom/dr-convex-env-vars pnpm run dr:sync-env
bash ./scripts/sync-dr-env-to-secrets-manager.sh --preview-name your-preview
```

If production uses `s3-primary` or `s3-mirror`, make sure the resulting secret includes:

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

## Trigger a Manual Backup

Use the GitHub Actions workflow:

- workflow: `Weekly DR Backup (Convex -> S3)`
- trigger: `workflow_dispatch`

The workflow should not be considered successful unless export, upload, deploy-test, and restore-test all pass.

## Run Full Recovery

For `custom-domain` recovery, set:

```bash
export AWS_DR_HOSTNAME_STRATEGY=custom-domain
export AWS_DR_DOMAIN=example.com
export AWS_DR_BACKUP_S3_BUCKET=your-dr-backup-bucket
```

For `provider-hostnames` recovery, set:

```bash
export AWS_DR_HOSTNAME_STRATEGY=provider-hostnames
export AWS_DR_BACKUP_S3_BUCKET=your-dr-backup-bucket
```

Recommended optional env vars:

```bash
export BETTER_AUTH_SECRETS=2:new-secret,1:old-secret
export BETTER_AUTH_SECRET=your-production-better-auth-secret
export JWKS='{"keys":[...]}'
```

When the storage stack is already deployed, treat the CloudFormation output
`StorageBrokerRuntimeUrl` as the canonical source for the broker runtime URL you
restore into Convex. Restore the broker assertion secrets from the DR env
secret rather than from stack outputs.

`AWS_DR_FRONTEND_CNAME_TARGET` remains available as an override, but `pnpm run dr:setup` now persists the Netlify frontend hostname in Secrets Manager so manual export is usually unnecessary.

Run recovery:

```bash
./infra/aws-cdk/scripts/dr-recover-ecs.sh
```

## What the Recovery Script Does

1. Deploys the ECS DR stack unless `SKIP_CDK_DEPLOY=true`
2. Reads CloudFormation outputs and the self-hosted instance secret
3. Waits for ECS and ALB health
4. Generates a self-hosted Convex admin key and persists it in AWS Secrets Manager for later DR frontend wiring
5. Sets minimum env vars and runs `pnpm exec convex deploy`
6. Downloads the newest S3 backup and imports it
7. Replays runtime env vars from Secrets Manager and applies DR overrides
8. Updates Cloudflare CNAMEs for backend, site, and frontend in `custom-domain` mode
9. Triggers the dedicated Netlify DR build hook
10. Verifies backend health directly and, when possible, through DR DNS

## Post-Recovery Checks

- Confirm `${AWS_DR_BACKUP_S3_BUCKET}` contains recent `convex-backups/` objects
- Confirm the backend responds at the recovered `ConvexBackendUrl`
- Confirm the Convex site host responds at the recovered `ConvexSiteUrl`
- Confirm the Netlify DR site builds successfully
- Confirm login and basic data access from the DR frontend
- Confirm file access behavior matches the active storage mode

## Known Limitations

- If production uses `FILE_STORAGE_BACKEND=convex`, uploaded Convex blobs are not covered by `convex export`
- Cloudflare automation only applies in `custom-domain` mode
- Return-to-primary reconciliation is operationally separate and is not automated in this repo
