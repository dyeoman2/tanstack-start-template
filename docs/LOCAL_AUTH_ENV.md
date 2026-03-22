# Local Better Auth Environment

This is the source of truth for local Better Auth setup in this repo.

## Canonical Manual Auth Origin

Use `http://localhost:3000` for manual auth flows:

- sign up
- email verification
- passkey enrollment
- authenticator app enrollment
- password reset links

Do not mix `http://localhost:3000` and `http://127.0.0.1:3000` during the same manual flow. Better Auth cookies are origin-scoped, so verification can succeed on one loopback host and the session can be missing on the other.

## Required Local Values

Set `BETTER_AUTH_URL` to `http://localhost:3000` in both places:

1. `.env.local`
2. the local Convex runtime env

Example:

```bash
npx convex env set BETTER_AUTH_URL http://localhost:3000
```

Then restart both local processes:

```bash
npx convex dev
pnpm dev
```

## Verification Email Happy Path

The intended local happy path is:

1. Open the app on `http://localhost:3000`
2. Sign up
3. Land on `/account-setup`
4. Click the verification link in the email
5. Return to `/account-setup?verified=success...`
6. Continue directly into MFA setup

If the verification email link points to `http://127.0.0.1:3000/api/auth/verify-email...`, the local Better Auth runtime env is still wrong.

## Automation Note

Some browser automation and E2E helpers in this repo still use `http://127.0.0.1:3000` intentionally. That is fine for automated tests. For manual Better Auth onboarding and email-link flows, use `http://localhost:3000`.
