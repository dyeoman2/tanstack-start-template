## Better Auth Security Notes

This project enforces the regulated baseline we ship, distinguishing the controls pinned in code and IaC from the deployer-owned ops that still need to be delivered.

### Why This Is Strict by Default

- The template now fails closed in production for Better Auth configuration. `BETTER_AUTH_URL` must be an absolute HTTPS origin unless it points to loopback development, and Better Auth secret material must be at least 32 characters long whether it arrives through `BETTER_AUTH_SECRET` or `BETTER_AUTH_SECRETS`.
- Preview hosts and extra trusted origins are opt-in only. Invalid `BETTER_AUTH_PREVIEW_HOSTS` or `BETTER_AUTH_TRUSTED_ORIGINS` values fail startup instead of being ignored.
- Site-admin and other privileged flows are expected to satisfy MFA or passkey requirements before access is granted.
- Better Auth runs with versioned-secret support when `BETTER_AUTH_SECRETS` is present, while `BETTER_AUTH_SECRET` remains the legacy fallback for older encrypted data.

### Email Verification

- Unverified email/password accounts are blocked from protected access by default.
- Verification emails are sent on sign up and can be re-sent from `/verify-email-pending` if a user loses access.
- Protected access does not exempt existing unverified accounts; once email verification is required for a path, any unverified account is blocked until it verifies.

### Rate Limiting

- Better Auth uses database-backed rate limiting in production and enforces stricter per-route limits for sign-in, sign-up, password reset, verification email resend, and sensitive admin actions.
- These limits are a defense-in-depth layer; deployers must still monitor rate-limit events, tune thresholds, and integrate with their own alerting pipelines.

### Origins and Base URL

- Better Auth requires a canonical site URL. Production deployments must use an HTTPS `BETTER_AUTH_URL`; only loopback development may use `http://127.0.0.1` or `http://localhost`.
- Local manual auth flows use `http://localhost:3000` as the canonical origin. See [`docs/LOCAL_AUTH_ENV.md`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/LOCAL_AUTH_ENV.md) for the required local `.env.local` and `npx convex env set BETTER_AUTH_URL ...` setup.
- Set `BETTER_AUTH_PREVIEW_HOSTS` to explicit host patterns such as `*.netlify.app,*.vercel.app` for ephemeral environments and add extra trusted origins via `BETTER_AUTH_TRUSTED_ORIGINS` when necessary.
- `BETTER_AUTH_TRUSTED_ORIGINS` must contain absolute origins such as `https://admin.example.com`; hostnames without a scheme are rejected at startup.
- Deployment hardening baseline is pinned in this repo through `src/server.ts`, `netlify.toml`, and `pnpm run deploy:doctor`; deployers still own TLS certificate lifecycle, WAF policy, and monitoring for origin spoofing.
- Production edges should send `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` or an equivalent HSTS policy.
- This repo no longer trusts raw forwarded client IP headers such as `x-forwarded-for`.
- Netlify-hosted app traffic signs a canonical `x-app-client-ip` header before proxying auth requests to Convex, and Convex Better Auth trusts only that verified header.
- Direct `.convex.site` requests that do not carry verified proxy metadata are treated as having no trusted client IP; security controls prefer unknown IP over spoofable IP.

### Cookies and Sessions

- Auth cookies are same-origin and `HttpOnly`, while `Secure` cookies turn on automatically for HTTPS base URLs.
- Session expiry, refresh cadence, and freshness windows are set via the shared Better Auth configuration to enforce short-lived credentials in regulated deployments.
- Session policy is explicit: 24-hour expiry, 4-hour refresh cadence, and 15-minute freshness windows for step-up protected actions.
- Better Auth session metadata is normalized after sign-in so downstream policy code can distinguish password, passkey, social, and enterprise authentication paths consistently.
- Production Convex operator/component access is **secret-tier production access** because it can expose active session rows, Better Auth JWKS private keys, populated OAuth secrets when present, and production env/deploy credentials.
- This repo intentionally keeps Better Auth sessions database-backed so revocation and admin session workflows reflect server state immediately. Treat active session rows as bearer-equivalent credentials and restrict operational access accordingly.
- A database compromise still implies session compromise for active sessions. That tradeoff is accepted in this incremental hardening baseline and should be countered with platform access controls, monitoring, and rapid revocation procedures.
- Break-glass password fallback is disabled by default for organization policies.
- Infrastructure-level controls beyond the shipped baseline (for example network isolation, secret rotation cadence, and hardware-backed secret custody) remain deployer responsibilities.

### Secret-Tier Operations

- Only named operators and CI may hold production Convex access; shared human accounts are out of policy.
- MFA is mandatory for every human path that can reach production Convex state or Better Auth component data.
- `CONVEX_DEPLOY_KEY` is treated as a production secret, not a convenience token.
- `.env.local` remains development-only, and `.env.prod` must not become the default home for long-lived deploy keys.
- Any uncertain or unauthorized production Convex access is handled as a secret-exposure incident.
- See [`docs/CONVEX_SECRET_TIER_ACCESS.md`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/docs/CONVEX_SECRET_TIER_ACCESS.md) for grant/revoke/review rules, Session purge, and the break-glass rotation order.
