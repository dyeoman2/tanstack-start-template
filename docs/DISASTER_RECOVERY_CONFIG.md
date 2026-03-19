# Disaster Recovery Configuration

For the guided end-to-end setup flow, run:

```bash
pnpm run dr:setup
```

That guided flow now persists the selected non-secret DR defaults into `.dr.env.local`, so later standalone `pnpm run dr:*` commands reuse the same bucket, hostname strategy, project slug, and ECS sizing unless you override them in the shell.

If the AWS DR stacks are already deployed and you only need to complete the Netlify/frontend failover lane, run:

```bash
pnpm run dr:netlify:setup
```

To fully remove DR resources and rerun setup from scratch later, use:

```bash
pnpm run dr:backup:destroy
pnpm run dr:ecs:destroy
pnpm run dr:destroy
```

`dr:destroy` removes the DR stacks plus the external DR artifacts that setup created outside CloudFormation:

- the DR Netlify site
- DR-specific GitHub Actions secrets
- DR-specific AWS Secrets Manager secrets
- `.dr.env.local`

## GitHub Actions Secrets

Required for [dr-backup-convex-s3.yml](/Users/yeoman/Desktop/tanstack/tanstack-start-template/.github/workflows/dr-backup-convex-s3.yml):

- `CONVEX_DEPLOY_KEY`
- `AWS_DR_BACKUP_ACCESS_KEY_ID`
- `AWS_DR_BACKUP_SECRET_ACCESS_KEY`
- `AWS_DR_BACKUP_REGION`
- `AWS_DR_BACKUP_S3_BUCKET`

Recommended for local self-hosted deploy validation inside the workflow:

- `DR_TEST_APP_NAME`
- `DR_TEST_BETTER_AUTH_SECRET`
- `DR_TEST_BETTER_AUTH_URL`
- `DR_TEST_CONVEX_SITE_URL`
- `DR_TEST_JWKS`

If the recommended test secrets are omitted, the workflow falls back to local development-style defaults where possible.

The weekly DR workflow can also retain backup verification in the control workspace by calling `security:recordBackupVerification` with the existing `CONVEX_DEPLOY_KEY`, so no separate callback URL or shared-secret env var is required.

## CDK Deploy-Time Environment Variables

### Shared

- `AWS_REGION`
- `CDK_DEFAULT_ACCOUNT`
- `CDK_DEFAULT_REGION`

### Existing malware scan stacks

The storage deploy commands are now stage-specific:

- `pnpm run storage:preview:dev`
- `pnpm run storage:deploy:dev`
- `pnpm run storage:preview:prod`
- `pnpm run storage:deploy:prod`
- `pnpm run storage:destroy:dev`
- `pnpm run storage:destroy:prod`

Those commands derive storage CDK inputs from the runtime storage env for the selected target:

- `AWS_REGION`
- `CONVEX_SITE_URL`
- `AWS_S3_FILES_BUCKET`
- `AWS_MALWARE_WEBHOOK_SHARED_SECRET`
- optional `AWS_PROFILE`

### DR backup stack

- `AWS_DR_BACKUP_S3_BUCKET`
- `AWS_DR_BACKUP_CI_USER_NAME`
- `AWS_DR_PROJECT_SLUG`

### DR ECS stack

- `AWS_DR_HOSTNAME_STRATEGY`
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

`AWS_DR_DOMAIN` and the `*_SUBDOMAIN` values are only required for `AWS_DR_HOSTNAME_STRATEGY=custom-domain`.
For `provider-hostnames`, the DR ECS stack uses AWS-generated backend/site URLs and the dedicated Netlify DR site URL directly.

## AWS Secrets Manager Secrets

Expected by [dr-recover-ecs.sh](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/aws-cdk/scripts/dr-recover-ecs.sh):

- `tanstack-start-template-dr-convex-admin-key-secret`
- `tanstack-start-template-dr-convex-env-secret`
- `tanstack-start-template-dr-cloudflare-dns-token-secret`
- `tanstack-start-template-dr-cloudflare-zone-id-secret`
- `tanstack-start-template-dr-netlify-build-hook-secret`
- `tanstack-start-template-dr-netlify-frontend-cname-target-secret`

If `AWS_DR_PROJECT_SLUG` is changed, the secret names change to match that slug.

Optional override env vars for non-default secret names:

- `AWS_DR_ENV_SECRET_NAME`
- `AWS_DR_CONVEX_ADMIN_KEY_SECRET_NAME`
- `AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME`
- `AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME`
- `AWS_DR_NETLIFY_HOOK_SECRET_NAME`
- `AWS_DR_NETLIFY_FRONTEND_CNAME_TARGET_SECRET_NAME`

The Convex runtime env secret can be refreshed with:

```bash
pnpm run dr:sync-env
```

## Runtime Variables Replayed During Recovery

The recovery script replays production Convex env vars from the DR env secret, then overrides the values that must change in DR.

At minimum, operators should expect the DR path to set or override:

- `APP_NAME`
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
- a DNS target value exposed to the recovery script via `AWS_DR_FRONTEND_CNAME_TARGET` or the persisted Netlify frontend CNAME target secret

This repo automates the build hook trigger and Cloudflare DNS repointing. The guided `pnpm run dr:setup` flow also attempts to create or validate the dedicated Netlify DR site when the Netlify CLI is authenticated, and falls back to manual instructions when that is not possible.
