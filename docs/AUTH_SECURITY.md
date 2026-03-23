## Better Auth Security Notes

This project enforces the regulated baseline we ship, distinguishing the controls in code from the deployer-owned ops that still need to be delivered.

### Why This Is Strict by Default

- The template now fails closed in production for Better Auth configuration. `BETTER_AUTH_SECRET` is required outside tests, must be at least 32 characters, and `BETTER_AUTH_URL` must be an absolute HTTPS origin unless it points to loopback development.
- Preview hosts and extra trusted origins are opt-in only. Invalid `BETTER_AUTH_PREVIEW_HOSTS` or `BETTER_AUTH_TRUSTED_ORIGINS` values fail startup instead of being ignored.
- Site-admin and other privileged flows are expected to satisfy MFA or passkey requirements before access is granted.

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
- Deployment hardening (security headers, TLS termination, and monitoring for origin spoofing) must live outside this repo.

### Cookies and Sessions

- Auth cookies are same-origin and `HttpOnly`, while `Secure` cookies turn on automatically for HTTPS base URLs.
- Session expiry, refresh cadence, and freshness windows are set via the shared Better Auth configuration to enforce short-lived credentials in regulated deployments.
- Session policy is explicit: 24-hour expiry, 4-hour refresh cadence, and 15-minute freshness windows for step-up protected actions.
- Better Auth session metadata is normalized after sign-in so downstream policy code can distinguish password, passkey, social, and enterprise authentication paths consistently.
- Break-glass password fallback is disabled by default for organization policies.
- Infrastructure-level controls (e.g., network isolation, secret rotation, hardware security modules for cookies) remain deployer responsibilities.
