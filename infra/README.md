# TanStack Start Template AWS Storage Infrastructure

This directory now contains the AWS CDK scaffold for the malware-scanned S3 storage path used by the storage platform.

## What It Deploys

- A versioned S3 files bucket with blocked public access, enforced SSL, S3-managed encryption, and retained deletion policy
- A GuardDuty detector and malware protection plan for the bucket
- An EventBridge rule for GuardDuty malware scan result events
- A Lambda forwarder that signs normalized findings and posts them to Convex
- Stack outputs for the bucket name, Lambda function name, and EventBridge rule name

## Layout

- `infra/storage.ts`: thin wrapper that runs CDK synth or deploy
- `infra/aws-cdk/bin/app.mjs`: CDK app entrypoint
- `infra/aws-cdk/lib/malware-scan-stack.cts`: stack definition
- `infra/aws-cdk/lambda/guardduty-forwarder.mjs`: webhook forwarder implementation

## Required Deploy-Time Environment Variables

The CDK app reads stage-specific values with `_DEV` / `_PROD` suffixes and falls back to the unsuffixed name.

- `AWS_REGION`
- `CONVEX_GUARDDUTY_WEBHOOK_URL_DEV`
- `CONVEX_GUARDDUTY_WEBHOOK_URL_PROD`
- `MALWARE_WEBHOOK_SHARED_SECRET_DEV`
- `MALWARE_WEBHOOK_SHARED_SECRET_PROD`
- `S3_FILES_BUCKET_NAME_DEV`
- `S3_FILES_BUCKET_NAME_PROD`

## Commands

Preview the synthesized stacks:

```bash
pnpm infra:preview
```

Deploy all configured stages:

```bash
pnpm infra:deploy
```

If only one stage has complete env configuration, the app deploys only that stage.

For guided production runtime env setup across Convex prod and Netlify:

```bash
pnpm run setup:storage:prod
```

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

## Notes

- The Lambda signs webhook payloads with `X-Scriptflow-Signature` and `X-Scriptflow-Timestamp`.
- The application verifies HMAC over `timestamp.payload`.
- Bucket lifecycle expiration is intentionally not configured for canonical file retention; application lifecycle deletion remains the source of truth.
