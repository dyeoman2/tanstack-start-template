# Convex Secret-Tier Access

Production Convex operator and component access is **secret-tier production access** in this repo.

That access can expose:

- active Better Auth session rows
- Better Auth JWKS private keys
- populated OAuth client or access-token secrets when present
- production env secrets and deploy credentials

## Rules

- Only named operators and CI may hold production Convex access.
- No shared human accounts.
- MFA is mandatory for human access.
- `CONVEX_DEPLOY_KEY` is a production secret, not a convenience token.
- `.env.local` is development-only.
- `.env.prod` may hold non-secret operator configuration, but must not be the default home for long-lived deploy keys.
- Any uncertain or unauthorized production Convex access is handled as a secret-exposure incident.

## Quarterly Access Review

- Review production Convex access quarterly and on every operator roster change.
- Confirm each human operator still needs access and is using a named account.
- Confirm CI remains the only unattended production deploy path.
- Record the review as a security evidence artifact in the existing security workspace flow.

## Break-Glass Response

- Restrict production Convex access to the approved operator set and CI first.
- Rotate `CONVEX_DEPLOY_KEY`.
- Rotate Better Auth secrets using the versioned-secret sequence in [`docs/DEPLOY_ENVIRONMENT.md`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/DEPLOY_ENVIRONMENT.md).
- Run Session purge with `pnpm run auth:sessions:purge -- --prod --ack-secret-tier`.
- Rotate Better Auth signing keys.
- Re-sync public-only JWKS with `pnpm run convex:jwks:sync -- --prod`.
- Run `pnpm run deploy:doctor -- --prod --json` and require a clean result.
- Record the response and rotation evidence in the security workspace.

## Session Purge

Use the dedicated break-glass command to remove every Better Auth session row on production Convex:

```bash
pnpm run auth:sessions:purge -- --prod --ack-secret-tier
```

For automation, set `CONVEX_SECRET_TIER_ACK=1`.
