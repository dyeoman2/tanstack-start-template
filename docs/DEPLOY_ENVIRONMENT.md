# Deployment environment checklist

This document ties together Convex, Netlify, and local env so production and development stay consistent.

## Convex dashboard hygiene

Variables such as `AUTUMN_*`, `CLOUDFLARE_*`, and `FIRECRAWL_*` are not read by this application. Remove them from Convex so secrets and mental overhead stay minimal.

Production Convex operator/component access is **secret-tier production access** in this repo. Review [`docs/CONVEX_SECRET_TIER_ACCESS.md`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/CONVEX_SECRET_TIER_ACCESS.md) before granting access or running live production mutation flows.

List known-unused names (dry run):

```bash
pnpm run convex:env:hygiene
```

Remove them (development deployment):

```bash
pnpm run convex:env:hygiene -- --apply
```

Production:

```bash
pnpm run convex:env:hygiene -- --apply --prod
```

Add `--yes` to skip the confirmation prompt.

The allowlist lives in `scripts/lib/convex-unused-env.ts`. Update it if you add a real integration that uses those prefixes.

## JWKS on Convex

Better Auth’s Convex plugin stores signing keys in the component database. For **static JWKS** (fewer HTTP round-trips when Convex validates JWTs), Convex deployment env var **`JWKS`** should contain the **public-only JWKS document** derived from that keyset, which is read from `convex/auth.config.ts` and `convex/betterAuth/sharedOptions.ts`.

### Where the value comes from

It is **not** invented by hand: the repo fetches the canonical Better Auth key docs via **`auth:getLatestJwks`**, then converts them to a public-only JWKS before writing the env var. Private signing keys stay in the Better Auth component database.

### Programmatic sync (recommended)

This repo wires that up for you:

```bash
pnpm run convex:jwks:sync
```

Production:

```bash
pnpm run convex:jwks:sync -- --prod
```

`pnpm run setup:convex` and `pnpm run setup:prod` **try this automatically** when `JWKS` is missing after deploy.

Do **not** pipe raw `auth:getLatestJwks` output directly into `convex env set JWKS`; that would duplicate private signing material into deploy env.

### Key rotation

`auth:rotateKeys` exists for rotation; prefer **`getLatestJwks` / `convex:jwks:sync`** for initial setup and after rotation so the public-only `JWKS` env var stays aligned with the component.

**After rotating keys**, run:

```bash
pnpm run convex:jwks:sync
```

For production Convex, add `-- --prod` to that command.

### Migration note

After shipping the public-only sync flow:

1. Re-run `pnpm run convex:jwks:sync` for each deployment so `JWKS` no longer contains private Better Auth key docs.
2. Rotate Better Auth signing keys once with `auth:rotateKeys`.
3. Re-run `pnpm run convex:jwks:sync` again so the env var contains the new public keys only.

## Better Auth secret rotation

Prefer versioned Better Auth secrets through `BETTER_AUTH_SECRETS`, while keeping `BETTER_AUTH_SECRET` as the fallback for pre-rotation data.

Example:

```dotenv
BETTER_AUTH_SECRETS=2:new-secret-base64,1:old-secret-base64
BETTER_AUTH_SECRET=old-secret-base64
```

Rotation sequence:

1. Add the new secret to the front of `BETTER_AUTH_SECRETS`.
2. Keep the prior secret in `BETTER_AUTH_SECRETS` and in `BETTER_AUTH_SECRET` during migration.
3. Deploy the app and Convex env changes together.
4. Rotate Better Auth signing keys and resync public JWKS.
5. Remove the legacy fallback only after old encrypted data is no longer needed.

## Netlify (or other host)

Production builds and SSR need:

- `AUTH_PROXY_SHARED_SECRET`
- `VITE_CONVEX_URL`

`pnpm run setup:prod` can push these to your Netlify **production** context when you opt in, using your Netlify personal access token and site id (`NETLIFY_AUTH_TOKEN` and linked site are auto-detected when possible). The `.convex.site` origin is derived from `VITE_CONVEX_URL` where needed.
`setup:prod` also orchestrates the guided production storage flow, the optional immutable audit archive flow, and the optional DR flow, and now reports their child-script readiness back in the final summary instead of treating “the child exited” as success.
At the end of the flow, `setup:prod` runs `pnpm run deploy:doctor -- --prod --json` and fails hard if required production checks still fail.

### Creating a site from the CLI

Netlify supports creating sites via the CLI/API (this repo already does that for the **DR** frontend in `scripts/setup-dr-netlify.ts` using `netlify api createSite` / `createSiteInTeam`). You can mirror that pattern for a **new** primary production site (same repo URL and build settings as an existing linked site) if you want full automation instead of clicking “New site” in the dashboard first.

You can also set them in the Netlify UI or with:

```bash
npx netlify env:set VITE_CONVEX_URL 'https://<deployment>.convex.cloud' --context production
npx netlify env:set AUTH_PROXY_SHARED_SECRET '<shared-secret>' --context production --secret
```

`AUTH_PROXY_SHARED_SECRET` must also exist on the matching Convex deployment so the app can sign the canonical Better Auth proxy headers that Convex verifies.

## Resend (email)

Convex sends mail via `RESEND_API_KEY` and optional `RESEND_EMAIL_SENDER` (`convex/emails.ts`).

- **Development:** put keys in `.env.local` and run `pnpm run setup:convex` (syncs to dev Convex).
- **Production:** `pnpm run setup:prod` prompts for `RESEND_API_KEY` and sets it on Convex production alongside `RESEND_EMAIL_SENDER`.

## Keeping `.env.local` and Convex dev in sync

After you change values that `setup:convex` normally pushes, run:

```bash
pnpm run setup:convex
```

To see whether sync keys are aligned between `.env.local` and Convex **dev** (missing names plus **non-secret** value drift):

```bash
pnpm run convex:env:verify
```

Exit code `1` means a configured local key is missing on Convex dev, or a comparable non-secret value differs. Secrets are still presence-only.

### Where configuration lives (avoid mixing secrets)

| Layer                         | Role                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **`.env`**                    | Optional shared defaults (often committed as a template only if your team uses it).                                                  |
| **`.env.local`**              | Primary **local dev secrets** and app URLs; gitignored. `setup:convex` reads this and pushes selected keys to **Convex dev**.        |
| **`.dr.env.local`**           | **DR-only** inputs; loaded **after** `.env.local` by `dr:setup` / `destroy-dr` so DR vars can override without polluting normal dev. |
| **Convex**                    | Dev vs prod deployment env (dashboard / `pnpm exec convex env …`).                                                                   |
| **Netlify**                   | Build + SSR env per context (`production`, `deploy-preview`, …).                                                                     |
| **`--env-file` (setup:prod)** | Explicit file for CI/automation; not merged into `.env.local`.                                                                       |

**`setup-prod.ts` / `setup:dr`** also set **`process.env`** (e.g. `AWS_REGION`, `AWS_PROFILE`, `AWS_DR_*`) for the lifetime of that Node process so child CLIs see the same region/profile. That does not write your shell’s environment after the script exits.

Child processes spawned from scripts inherit the **current** `process.env` (including anything loaded above). Convex CLI calls use the same inheritance, so `CONVEX_DEPLOY_KEY` in the shell affects prod Convex commands.

That means a shell with production Convex access is already in the secret-tier lane. Prefer named operator access for humans and environment-scoped CI secrets for unattended workflows.

### CLI preflight

Most `pnpm run setup:*`, `convex:*`, and `deploy:doctor` scripts exit early with **install hints** if a required tool is missing on `PATH` (for example `pnpm`, `pnpm exec convex`, `openssl` for prod secrets, `gh`/`git` for GitHub deploy wiring, `netlify` before Netlify sync, `aws` before S3 storage flows). They **do not** auto-install packages; follow the printed links or commands, then rerun.

Production-mutating operator flows now also require an explicit secret-tier acknowledgment:

```bash
--ack-secret-tier
```

For non-interactive automation, set:

```bash
CONVEX_SECRET_TIER_ACK=1
```

The affected production operator flows include `setup:prod`, `storage:setup:prod`, `audit-archive:setup -- --prod`, `dr:setup`, and the break-glass Session purge command.

### Deploy readiness

```bash
pnpm run deploy:doctor
```

Add `-- --prod` to include production Convex env list + JWKS checks, plus hints when `CONVEX_DEPLOY_KEY` / `NETLIFY_AUTH_TOKEN` are unset.

When production Convex access is available, `deploy:doctor -- --prod` also reports whether the current run explicitly acknowledged secret-tier production access, whether `.env.prod` is improperly storing `CONVEX_DEPLOY_KEY`, and whether the secret-tier runbook/docs are present.

For S3-backed storage, `deploy:doctor` also fails if the Convex deployment is missing any required runtime variables:

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

It also verifies the repo-pinned Netlify hardening headers in [`netlify.toml`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/netlify.toml).

For S3-backed storage, immutable audit archiving is required and `deploy:doctor` also requires:

- `AWS_AUDIT_ARCHIVE_BUCKET`
- `AWS_AUDIT_ARCHIVE_KMS_KEY_ARN`
- `AWS_AUDIT_ARCHIVE_ROLE_ARN`

`AWS_AUDIT_ARCHIVE_PREFIX` is optional and defaults to `audit-ledger/`.

For S3-backed production, immutable audit archiving is now a release gate, not just a setup step.
`deploy:doctor -- --prod` fails unless all of the following are true:

- audit archive runtime env is complete
- the exporter is enabled
- the latest seal has been exported
- archive lag is zero
- no seal/export drift is detected
- the latest sealed segment has been successfully verified in immutable storage

The archive verification result is also retained as buyer-facing evidence through the security
workspace and audit readiness report payloads.

For AWS storage infrastructure preview/deploy, the operator environment also needs:

- `AWS_FILE_SERVE_SIGNING_SECRET`
- `AWS_STORAGE_BROKER_EDGE_ASSERTION_SECRET`
- `AWS_STORAGE_BROKER_CONTROL_ASSERTION_SECRET`
- `AWS_CONVEX_STORAGE_CALLBACK_BASE_URL`
- `AWS_CONVEX_STORAGE_DECISION_CALLBACK_SHARED_SECRET`
- `AWS_CONVEX_DOCUMENT_RESULT_CALLBACK_SHARED_SECRET`
- `AWS_CONVEX_STORAGE_INSPECTION_CALLBACK_SHARED_SECRET`
- optional `AWS_STORAGE_ALERT_EMAIL`

For S3-backed storage setup, `pnpm run storage:setup:prod` now auto-discovers `StorageBrokerRuntimeUrl` from the deployed CloudFormation stack, persists the broker assertion secrets to `.env.prod`, and reports `needs attention` when the runtime URL or assertion secrets are still missing.

For immutable audit archiving, use the dedicated guided flow:

```bash
pnpm run audit-archive:setup -- --prod
```

That flow persists both deploy-time inputs and the runtime outputs (`AWS_AUDIT_ARCHIVE_BUCKET`, `AWS_AUDIT_ARCHIVE_KMS_KEY_ARN`, `AWS_AUDIT_ARCHIVE_ROLE_ARN`) to `.env.prod`, and can sync the runtime values into Convex production when the stack outputs are available.

When `AWS_STORAGE_ALERT_EMAIL` is configured, the archive stack also provisions SNS-backed
CloudWatch alarms for exporter disablement, archive lag, seal/export drift, and latest-seal
verification failure.

For direct operator or CI deploys of the immutable archive stack, use:

```bash
pnpm run audit-archive:preview
pnpm run audit-archive:deploy
```

The storage CDK stack creates dedicated broker and worker runtime roles and scopes the
per-capability storage roles so only those runtime roles can assume them.
When `AWS_STORAGE_ALERT_EMAIL` is set for production storage deploys, the stack creates an SNS Standard topic with an email subscription and wires the storage alarms to it.
`deploy:doctor -- --prod` now treats an unconfirmed storage alert email subscription as a failed production readiness check when `AWS_STORAGE_ALERT_EMAIL` is configured in `.env.prod`.

### `setup:prod` flags

Non-interactive-oriented options (combine as needed):

- `--yes` — accept affirmative defaults and skip optional prompts where safe
- `--env-file <path>` — read `RESEND_API_KEY`, optional `CONVEX_DEPLOY_KEY`, and optional `BETTER_AUTH_URL` / `DEPLOY_SMOKE_BASE_URL` for smoke URL
- `--smoke-base-url <url>` — with `--yes`, sets production smoke / `BETTER_AUTH_URL` without a prompt
- `--skip-github-deploy` — skip GitHub Actions environment wiring (still offers `BETTER_AUTH_URL`)
- `--create-netlify-site <name>` — create a new Netlify site mirroring the **linked** primary site’s repo settings (requires `netlify link` first)
- `--ack-secret-tier` — required for production mutation; acknowledges that the current run can reach secret-tier Convex data

## Secret-Tier Rotation Order

For the initial rollout or any suspected exposure event:

1. Restrict production Convex access to the approved operator set and CI.
2. Rotate `CONVEX_DEPLOY_KEY`.
3. Rotate Better Auth secrets using the versioned-secret sequence above.
4. Run Session purge with `pnpm run auth:sessions:purge -- --prod --ack-secret-tier`.
5. Rotate Better Auth signing keys.
6. Re-sync public-only JWKS with `pnpm run convex:jwks:sync -- --prod`.
7. Run `pnpm run deploy:doctor -- --prod --json` and require a clean result.
8. Record the access review and rotation evidence in the security workspace.
