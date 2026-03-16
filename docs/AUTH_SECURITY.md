## Better Auth Security Notes

This project enforces the regulated baseline we ship, distinguishing the controls in code from the deployer-owned ops that still need to be delivered.

### Email Verification

- New email/password accounts created on or after the enforced timestamp must verify their email before accessing protected `/app` routes. Existing unverified users created before that timestamp remain grandfathered until they reverify.
- Verification emails are sent on sign up and can be re-sent from `/verify-email-pending` if a user loses access.
- Configure `EMAIL_VERIFICATION_ENFORCED_AT` (or `VITE_EMAIL_VERIFICATION_ENFORCED_AT`, with `BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT` for legacy tooling); otherwise the hard-coded date in [`src/lib/shared/email-verification.ts`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/src/lib/shared/email-verification.ts) applies.

### Rate Limiting

- Better Auth uses database-backed rate limiting in production and enforces stricter per-route limits for sign-in, sign-up, password reset, verification email resend, and sensitive admin actions.
- These limits are a defense-in-depth layer; deployers must still monitor rate-limit events, tune thresholds, and integrate with their own alerting pipelines.

### Origins and Base URL

- Better Auth requires a canonical site URL and allows dynamic host allowlisting for preview deployments.
- Set `BETTER_AUTH_PREVIEW_HOSTS` to patterns such as `*.netlify.app,*.vercel.app` for ephemeral environments and add extra trusted origins via `BETTER_AUTH_TRUSTED_ORIGINS` when necessary.
- Deployment hardening (security headers, TLS termination, and monitoring for origin spoofing) must live outside this repo.

### Cookies and Sessions

- Auth cookies are same-origin and `HttpOnly`, while `Secure` cookies turn on automatically for HTTPS base URLs.
- Session expiry, refresh cadence, and freshness windows are set via the shared Better Auth configuration to enforce short-lived credentials in regulated deployments.
- Infrastructure-level controls (e.g., network isolation, secret rotation, hardware security modules for cookies) remain deployer responsibilities.
