# Better Auth Verification

Run `pnpm verify:better-auth` after every Better Auth plugin or schema change.

This repository uses the Convex Better Auth adapter, so the verification flow is:

1. Run the official Better Auth CLI step for this adapter shape:
   `pnpm exec better-auth generate --config convex/betterAuth/cli-auth.ts --output /tmp/better-auth-generated-schema.ts -y`
2. Validate server/client plugin parity for `twoFactor` and `passkey`
3. Validate the local Better Auth schema via `npx convex codegen`
4. Run `pnpm typecheck`
5. Verify `GET /api/auth/ok`

The script requires either `BETTER_AUTH_VERIFY_URL` or `BETTER_AUTH_URL` to point at a running app server so the health check can hit `/api/auth/ok`. If the CLI, plugin parity, codegen, and typecheck all pass but the app server is not reachable, the script should fail with a runtime health-check error that calls out the missing server separately from config or typing failures.

`pnpm verify:better-auth` runs the full sequence above. For the Convex adapter, the safe CLI workflow is `generate` to a temporary file rather than `migrate`, because this repo owns a customized local Better Auth schema file. The CLI step is still kept so auth plugin/config changes go through the canonical Better Auth tooling before the adapter-specific codegen check. Install `@better-auth/cli` locally and run it through `pnpm exec` so the repo uses a pinned CLI version instead of `npx @latest`.

The CLI uses [convex/betterAuth/cli-auth.ts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/convex/betterAuth/cli-auth.ts), which exists only to satisfy Better Auth's requirement for a concrete exported auth instance during tooling runs. The app runtime should continue to use `getOptions()` and runtime-created auth instances instead of importing a concrete auth instance directly.

## Current integration notes

- This repo intentionally uses plain `createAuthClient({ ... })` plus `inferAdditionalFields<ReturnType<typeof getOptions>>()` and `authClient.$Infer.Session`. Do not force `createAuthClient<typeof auth>()` with casts until the Better Auth client generic supports this stack cleanly.
- The fresh-session check is intentionally kept behind an internal Better Auth integration endpoint and a single server helper because Better Auth exposes freshness middleware at the auth-endpoint layer, while TanStack/Convex server code needs a Better Auth-backed freshness decision outside that layer.
- The remaining workaround layers can be deleted when upstream support exists for:
  - `createAuthClient<typeof auth>()`
  - a first-class Better Auth or Convex-adapter server helper for fresh-session checks
  - automatic custom plugin endpoint inference into the local `auth.api` surface
