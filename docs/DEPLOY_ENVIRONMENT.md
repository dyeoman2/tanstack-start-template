# Deployment environment checklist

This document ties together Convex, Netlify, and local env so production and development stay consistent.

## Convex dashboard hygiene

Variables such as `AUTUMN_*`, `CLOUDFLARE_*`, and `FIRECRAWL_*` are not read by this application. Remove them from Convex so secrets and mental overhead stay minimal.

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

Better Auth’s Convex plugin stores signing keys in the component database. For **static JWKS** (fewer HTTP round-trips when Convex validates JWTs), the same material must also live in the Convex deployment env var **`JWKS`**, which is read from `convex/auth.config.ts` and `convex/betterAuth/sharedOptions.ts`.

### Where the value comes from

It is **not** invented by hand: you copy the canonical JWKS payload from Better Auth via the Convex action **`auth:getLatestJwks`** (see [Convex + Better Auth — Static JWKS](https://labs.convex.dev/better-auth/experimental)).

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

Manual equivalent (pipe form from the docs):

```bash
pnpm exec convex run auth:getLatestJwks | pnpm exec convex env set JWKS
```

Add `--prod` on both commands for production.

### Key rotation

`auth:rotateKeys` exists for rotation; prefer **`getLatestJwks` / `convex:jwks:sync`** for initial setup and after rotation so the `JWKS` env var stays aligned with the component.

**After rotating keys**, run:

```bash
pnpm run convex:jwks:sync
```

For production Convex, add `-- --prod` to that command.

## Netlify (or other host)

Production builds and SSR need:

- `BETTER_AUTH_SECRET` (same secret as Convex production)
- `VITE_CONVEX_URL`

`pnpm run setup:prod` can push these to your Netlify **production** context when you opt in, using your Netlify personal access token and site id (`NETLIFY_AUTH_TOKEN` and linked site are auto-detected when possible). The `.convex.site` origin is derived from `VITE_CONVEX_URL` where needed.

### Creating a site from the CLI

Netlify supports creating sites via the CLI/API (this repo already does that for the **DR** frontend in `scripts/setup-dr-netlify.ts` using `netlify api createSite` / `createSiteInTeam`). You can mirror that pattern for a **new** primary production site (same repo URL and build settings as an existing linked site) if you want full automation instead of clicking “New site” in the dashboard first.

You can also set them in the Netlify UI or with:

```bash
npx netlify env:set BETTER_AUTH_SECRET '<secret>' --context production --secret
npx netlify env:set VITE_CONVEX_URL 'https://<deployment>.convex.cloud' --context production
```

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

### CLI preflight

Most `pnpm run setup:*`, `convex:*`, and `deploy:doctor` scripts exit early with **install hints** if a required tool is missing on `PATH` (for example `pnpm`, `pnpm exec convex`, `openssl` for prod secrets, `gh`/`git` for GitHub deploy wiring, `netlify` before Netlify sync, `aws` before S3 storage flows). They **do not** auto-install packages; follow the printed links or commands, then rerun.

### Deploy readiness

```bash
pnpm run deploy:doctor
```

Add `-- --prod` to include production Convex env list + JWKS checks, plus hints when `CONVEX_DEPLOY_KEY` / `NETLIFY_AUTH_TOKEN` are unset.

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
- `AWS_GUARDDUTY_WEBHOOK_SHARED_SECRET`
- `AWS_STORAGE_INSPECTION_WEBHOOK_SHARED_SECRET`
- `AWS_STORAGE_ROLE_ARN_UPLOAD_PRESIGN`
- `AWS_STORAGE_ROLE_ARN_DOWNLOAD_PRESIGN`
- `AWS_STORAGE_ROLE_ARN_PROMOTION`
- `AWS_STORAGE_ROLE_ARN_REJECTION`
- `AWS_STORAGE_ROLE_ARN_CLEANUP`
- `AWS_STORAGE_ROLE_ARN_MIRROR`

It also verifies the repo-pinned Netlify hardening headers in [`netlify.toml`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/netlify.toml).

If immutable audit archiving is enabled, `deploy:doctor` also requires:

- `AWS_AUDIT_ARCHIVE_BUCKET`
- `AWS_AUDIT_ARCHIVE_KMS_KEY_ARN`
- `AWS_AUDIT_ARCHIVE_ROLE_ARN`

`AWS_AUDIT_ARCHIVE_PREFIX` is optional and defaults to `audit-ledger/`.

For AWS storage infrastructure preview/deploy, the operator environment also needs:

- `AWS_STORAGE_TRUSTED_PRINCIPAL_ARN`

The storage CDK stack uses that ARN as the only principal allowed to assume the per-capability storage roles.

### `setup:prod` flags

Non-interactive-oriented options (combine as needed):

- `--yes` — accept affirmative defaults and skip optional prompts where safe
- `--env-file <path>` — read `RESEND_API_KEY`, optional `CONVEX_DEPLOY_KEY`, and optional `BETTER_AUTH_URL` / `DEPLOY_SMOKE_BASE_URL` for smoke URL
- `--smoke-base-url <url>` — with `--yes`, sets production smoke / `BETTER_AUTH_URL` without a prompt
- `--skip-github-deploy` — skip GitHub Actions environment wiring (still offers `BETTER_AUTH_URL`)
- `--create-netlify-site <name>` — create a new Netlify site mirroring the **linked** primary site’s repo settings (requires `netlify link` first)
