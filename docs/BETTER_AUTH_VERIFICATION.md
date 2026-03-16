# Better Auth Verification

Run `pnpm verify:better-auth` after every Better Auth plugin or schema change.

This repository uses the Convex Better Auth adapter, so the verification flow is:

1. Run the official Better Auth CLI step for this adapter shape:
   `pnpm exec better-auth generate --config convex/betterAuth/options.ts --output /tmp/better-auth-generated-schema.ts -y`
2. Validate server/client plugin parity for `twoFactor` and `passkey`
3. Validate the local Better Auth schema via `npx convex codegen`
4. Run `pnpm typecheck`
5. Verify `GET /api/auth/ok`

The script requires either `BETTER_AUTH_VERIFY_URL` or `BETTER_AUTH_URL` to point at a running app server so the health check can hit `/api/auth/ok`.

`pnpm verify:better-auth` runs the full sequence above. For the Convex adapter, the safe CLI workflow is `generate` to a temporary file rather than `migrate`, because this repo owns a customized local Better Auth schema file. The CLI step is still kept so auth plugin/config changes go through the canonical Better Auth tooling before the adapter-specific codegen check. Install `@better-auth/cli` locally and run it through `pnpm exec` so the repo uses a pinned CLI version instead of `npx @latest`.
