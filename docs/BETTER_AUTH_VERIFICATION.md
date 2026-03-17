# Better Auth Verification

Run `pnpm verify:better-auth` after every Better Auth plugin or schema change.

This repository uses the Convex Better Auth adapter, so the verification flow is:

1. Run the official Better Auth CLI step for this adapter shape:
   `pnpm exec better-auth generate --config better-auth.cli.ts --output /tmp/better-auth-generated-schema.ts -y`
2. Validate server/client plugin parity for `twoFactor` and `passkey`
3. Validate the local Better Auth schema via `npx convex codegen`
4. Run `pnpm typecheck`
5. Verify `GET /api/auth/ok`

The script requires either `BETTER_AUTH_VERIFY_URL` or `BETTER_AUTH_URL` to point at a running app server so the health check can hit `/api/auth/ok`. If the CLI, plugin parity, codegen, and typecheck all pass but the app server is not reachable, the script should fail with a runtime health-check error that calls out the missing server separately from config or typing failures.

`pnpm verify:better-auth` runs the full sequence above. For the Convex adapter, the safe CLI workflow is `generate` to a temporary file rather than `migrate`, because this repo owns a customized local Better Auth schema file. The CLI step is still kept so auth plugin/config changes go through the canonical Better Auth tooling before the adapter-specific codegen check. Install `@better-auth/cli` locally and run it through `pnpm exec` so the repo uses a pinned CLI version instead of `npx @latest`.

The CLI uses [better-auth.cli.ts](/Users/yeoman/Desktop/tanstack/tanstack-start-template/better-auth.cli.ts), which exists only to satisfy Better Auth's requirement for a concrete exported auth instance during tooling runs. The app runtime should continue to use `getOptions('runtime')` and runtime-created auth instances instead of importing a concrete auth instance directly.

## Versioning constraints

- The Better Auth runtime packages in this repo may move ahead of the stable `@better-auth/cli` release line. Do not assume the CLI version must exactly equal the runtime package version.
- Prefer the latest stable CLI release that supports the current runtime/plugin shape, and treat `pnpm verify:better-auth` as the compatibility gate.
- Do not switch this repo to `npx @better-auth/cli@latest` or a beta/canary CLI without explicitly validating the Convex adapter workflow.

## Current integration notes

- This repo intentionally uses plain `createAuthClient({ ... })` plus `inferAdditionalFields<ReturnType<typeof getOptions>>()` and `authClient.$Infer.Session`. Do not force `createAuthClient<typeof auth>()` with casts until the Better Auth client generic supports this stack cleanly.
- This repo intentionally carries a small adapter typing escape hatch around `convexAdapter(...)` in the shared Better Auth options. Keep that localized and remove it only when the adapter exposes a clean typed initialization path for this stack.
- Session enrichment is path-mapped in one place inside [`convex/betterAuth/sharedOptions.ts`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/convex/betterAuth/sharedOptions.ts). When enabling a new Better Auth auth method, add it there and add a regression test before shipping.
- Sensitive server-side checks use Better Auth's native `get-session` path with `disableCookieCache=true`, then evaluate freshness from the returned session timestamps plus the configured fresh-session window.
- The remaining gap that still depends on upstream Better Auth or adapter improvements is tighter client/server typing and a first-class server helper for the same non-cached session read without any local boundary code.
