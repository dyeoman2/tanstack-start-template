# Script Command Map

Use this as the shortest path from intent to command.

Automation-focused JSON/plan usage lives in [SCRIPT_AUTOMATION.md](./SCRIPT_AUTOMATION.md).

## Local setup

- New machine / first local setup: `pnpm run setup:dev`
- Start the standard local app runtime: `pnpm dev`
- Start the Docker-backed local runtime path: `pnpm run dev:docker`
- Re-sync `.env.local` into Convex dev: `pnpm run setup:convex`
- Check `.env.local` vs Convex drift: `pnpm run convex:env:verify`
- Refresh Convex JWKS in dev: `pnpm run convex:jwks:sync`

## Browser automation and E2E

- Set up local authenticated E2E defaults: `pnpm run setup:e2e`
- Authenticate an `agent-browser` session: `pnpm run agent:auth -- --session-name <name>`
- Authenticate and snapshot an `agent-browser` session: `pnpm run agent:inspect -- --session-name <name>`
- Inspect an authenticated page with Playwright: `pnpm run playwright:inspect -- --path /app`

## User/admin operations

- Promote a user to admin: `pnpm make-admin <email>`

## Production and deploy operations

- Check deploy readiness: `pnpm run deploy:doctor`
- Check deploy readiness including prod access: `pnpm run deploy:doctor -- --prod`
- Guided production setup: `pnpm run setup:prod -- --ack-secret-tier`
- Preview the production setup plan: `pnpm run setup:prod -- --plan --json`
- GitHub deploy environment wiring only: `pnpm run setup:github-deploy`
- Remove known-unused Convex env vars: `pnpm run convex:env:hygiene`
- Remove known-unused Convex env vars in prod: `pnpm run convex:env:hygiene -- --apply --prod`
- Refresh Convex JWKS in prod: `pnpm run convex:jwks:sync -- --prod`
- Break-glass Better Auth Session purge in prod: `pnpm run auth:sessions:purge -- --prod --ack-secret-tier`

## Storage

- Guided local storage setup: `pnpm run storage:setup`
- Guided production storage setup: `pnpm run storage:setup:prod -- --ack-secret-tier`
- Guided immutable audit archive setup: `pnpm run audit-archive:setup -- --prod --ack-secret-tier`
- Preview immutable audit archive infra: `pnpm run audit-archive:preview`
- Deploy immutable audit archive infra: `pnpm run audit-archive:deploy`
- Destroy all repo-managed AWS resources: `pnpm run aws:destroy:all`
- Verify repo-managed AWS teardown left no repo-scoped AWS resources: run the four AWS CLI checks in [infra/README.md](/Users/yeoman/Desktop/tanstack/tanstack-start-template/infra/README.md)
- Destroy immutable audit archive infra: `pnpm run audit-archive:destroy`
- Preview local AWS-backed storage infra: `pnpm run storage:preview:dev`
- Deploy local AWS-backed storage infra: `pnpm run storage:deploy:dev`
- Preview production AWS-backed storage infra: `pnpm run storage:preview:prod`
- Deploy production AWS-backed storage infra: `pnpm run storage:deploy:prod`
- Destroy local AWS-backed storage infra: `pnpm run storage:destroy:dev`
- Destroy production AWS-backed storage infra: `pnpm run storage:destroy:prod`

## Disaster recovery

- Guided end-to-end DR setup: `pnpm run dr:setup -- --ack-secret-tier`
- Preview the DR setup plan: `pnpm run dr:setup -- --plan --json`
- DR frontend/Netlify-only setup: `pnpm run dr:netlify:setup`
- DR frontend/Netlify-only alias: `pnpm run dr:netlify`
- Preview DR backup stack: `pnpm run dr:backup:preview`
- Deploy DR backup stack: `pnpm run dr:backup:deploy`
- Preview DR ECS stack: `pnpm run dr:ecs:preview`
- Deploy DR ECS stack: `pnpm run dr:ecs:deploy`
- Destroy DR backup stack: `pnpm run dr:backup:destroy`
- Destroy DR ECS stack: `pnpm run dr:ecs:destroy`
- Destroy all DR resources: `pnpm run dr:destroy -- --stack all`
- Destroy all DR resources but keep DR AWS Secrets Manager secrets: `pnpm run dr:destroy -- --stack all --keep-secrets`
- Destroy all DR resources via alias: `pnpm run dr:all:destroy`
