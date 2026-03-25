# Agent Browser Workflows

Use these commands when an AI agent needs to verify UI changes in the local app with `agent-browser`.

## Prerequisites

- Local app running at `http://127.0.0.1:3000`
- `ENABLE_E2E_TEST_AUTH=true`
- `E2E_TEST_SECRET` present in `.env.local`
- `agent-browser` installed and available on `PATH`

The `agent:auth` and `agent:inspect` scripts auto-provision the deterministic E2E principals through CLI tooling before they hit the test auth routes. If you want to pre-create them yourself, run `pnpm run e2e:provision`.

## Auth + Snapshot

Authenticate a normal user session, wait for the app shell, inspect the page, then clean up:

```bash
pnpm run agent:inspect -- --session-name codex-ui --principal user --redirect-to /app
pnpm run agent:close -- --session-name codex-ui
```

## Auth + Admin Snapshot

Authenticate an admin session and inspect an admin-only page:

```bash
pnpm run agent:inspect -- --session-name codex-admin --principal admin --redirect-to /app/admin
pnpm run agent:close -- --session-name codex-admin
```

## Auth + Screenshot

Capture a screenshot after authentication:

```bash
pnpm run agent:auth -- --session-name codex-shot --principal user --redirect-to /app
agent-browser --session-name codex-shot wait --load networkidle
agent-browser --session-name codex-shot screenshot
pnpm run agent:close -- --session-name codex-shot
```

## Reliability Rules

- Use `http://127.0.0.1:3000`, not `http://localhost:3000`.
- Use a fresh named session per task.
- Wait for `networkidle` before the first snapshot on a new page.
- Re-run `snapshot -i` after every navigation or DOM-changing interaction.
- Close the named session when done.

## Failure Triage

- `403 Missing or null Origin`
  - Use `pnpm run agent:auth` or `pnpm run agent:inspect` instead of hand-rolled requests.
  - If you are scripting the route manually, make the request from inside the browser session, not from a detached HTTP client.

- `401 Unauthorized` or `404 Not found` from `/api/test/agent-auth`
  - Confirm `ENABLE_E2E_TEST_AUTH=true` in `.env.local`.
  - Confirm `E2E_TEST_SECRET` exists locally and matches the current app environment.
  - If you are calling the route directly instead of using the helper scripts, run `pnpm run e2e:provision` first so the principal already exists.

- Redirected back to `/login` or app shell shows unauthenticated errors
  - Use `http://127.0.0.1:3000`, not `http://localhost:3000`.
  - Start from a fresh named session.
  - Re-run `pnpm run agent:auth` to refresh the session cookies.

- `agent-browser` starts but the page looks stale
  - Use a new `--session-name` for the task or close the prior session first.
  - Wait for `networkidle` before taking the first snapshot.
