## Better Auth Security Notes

This project enforces a stricter Better Auth posture than the starter defaults.

### Email Verification

- New email/password accounts created on or after the verification rollout cutoff must verify their email before accessing protected `/app` routes.
- Existing unverified users created before that cutoff are grandfathered.
- Verification emails are sent on sign up and can be re-sent from the `/verify-email-pending` route.
- Set `EMAIL_VERIFICATION_ENFORCED_AT` in the server environment to control the rollout timestamp. `VITE_EMAIL_VERIFICATION_ENFORCED_AT` also works for shared runtime config, and the legacy `BETTER_AUTH_EMAIL_VERIFICATION_ENFORCED_AT` name remains a non-Convex fallback. If omitted, the app falls back to the built-in rollout date in [`src/lib/shared/email-verification.ts`](/Users/yeoman/Desktop/tanstack/tanstack-start-template/src/lib/shared/email-verification.ts).

### Rate Limiting

- Better Auth uses database-backed rate limiting in production.
- Sensitive endpoints have stricter per-route limits, including sign-in, sign-up, password reset, verification email resend, and selected admin session actions.
- App-side rate limiting remains as defense in depth for higher-level orchestration flows.

### Origins And Base URL

- Better Auth uses a canonical site URL plus dynamic host allowlisting for preview deployments.
- Configure preview host patterns with `BETTER_AUTH_PREVIEW_HOSTS` as a comma-separated list such as `*.netlify.app,*.vercel.app`.
- Add explicit extra origins with `BETTER_AUTH_TRUSTED_ORIGINS` when a deployment needs non-pattern-based allowlisting.

### Cookies And Sessions

- Auth cookies stay same-origin and `HttpOnly`.
- `Secure` cookies are enabled automatically when the canonical base URL is HTTPS.
- Session expiry, refresh cadence, and freshness windows are configured explicitly in the shared Better Auth options.
