# Script Automation

This page covers the scripts that are safest to call from automation and the structured output they emit.

## Structured output

Scripts with `--json` emit machine-readable JSON on `stdout` and route human-oriented logs to `stderr`.

Each JSON payload includes:

- `schemaVersion`

Current schema version:

- `1`

## Good automation candidates

- `pnpm run deploy:doctor -- --json`
- `pnpm run setup:prod -- --plan --json`
- `pnpm run dr:setup -- --plan --json`
- `pnpm run storage:setup -- --json`
- `pnpm run storage:setup:prod -- --json`
- `pnpm run audit-archive:setup -- --prod --json`
- `pnpm run dr:netlify:setup -- --json`
- `pnpm run convex:env:hygiene -- --json`
- `pnpm run setup:e2e -- --json`
- `pnpm run setup:convex -- --json`

## Exit code guidance

- `deploy:doctor`
  Returns non-zero when required checks fail.
- `convex:env:verify`
  Returns non-zero when synced keys are missing or non-secret values drift.
- `convex:env:hygiene`
  Returns non-zero when Convex access is not ready.
- `setup:prod -- --plan --json`
  Returns zero when planning succeeds without making changes.
- `dr:setup -- --plan --json`
  Returns zero when planning succeeds after discovery.

## Non-interactive mode

Scripts that support `--yes` also accept:

- `--non-interactive`

This is an alias for clearer CI/operator usage.

## Notes

- Prefer `--plan --json` before using a live mutating operator flow in CI or scripted automation.
- Production-mutating operator flows require `--ack-secret-tier` or `CONVEX_SECRET_TIER_ACK=1`.
- For mutating scripts, treat the JSON payload as a summary contract, not a full event stream.
- `setup:prod` now runs a final `deploy:doctor -- --prod --json` validation gate and exits non-zero when required production checks still fail.
