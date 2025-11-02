# Hackathon MVP Implementation Plan

## Current Foundations
- `src/routes/index.tsx` already renders the marketing home and redirects authenticated users to `/app`.
- `/app` is guarded by `routeAuthGuard` (`src/routes/app.tsx`) and presently loads the admin-focused dashboard (`src/features/dashboard`).
- Better Auth + Convex integration is live (`convex/auth.ts`, `src/features/auth/server/**`), including route guards and profile management.
- Convex schema currently only covers `userProfiles`, `auditLogs`, `dashboardStats`, and `rateLimit` (`convex/schema.ts`); no hackathon-domain tables exist yet.
- Email delivery and Netlify function plumbing exist in `convex/emails.ts` and `netlify.toml`, but invitation flows are not implemented.
- There is no Firecrawl, Cloudflare AI Gateway, or hackathon-specific UI in the codebase today.

## Decisions
- AI scoring contract: stream Markdown tokens and conclude with a final JSON object `{ "score": number (0-100), "summary": string }`; if parsing fails, persist `score = null` alongside the full text summary. Default Cloudflare AI model: `@cf/meta/llama-3.1-8b-instruct` (best available on the free tier).
- Invite email template ownership: reuse the Resend-powered pipeline in `convex/emails.ts`, adding a dedicated hackathon invite template and keeping copy management server-side.
- Hackathon access model: hackathon `owner` implicitly receives `admin` capabilities for that hackathon; standalone `admin` role remains for delegated management.
- Board column configuration: ship a fixed four-column workflow (`submitted`, `review`, `shortlist`, `winner`) baked into constants across client/server.
- Admin dashboard: keep `/app/admin` live behind `routeAdminGuard` for system-level reporting post-MVP.
- Kanban UX: provide intuitive drag-and-drop across desktop, tablet, and touch devices; no additional progressive enhancement requirements at this stage.
- Progressive enhancement: acceptable to focus on hydrated SPA flows; server-rendered pages may assume JavaScript is available for interactive actions.
- Observability: favor lightweight instrumentation—server-side structured logs + Convex audit entries—for AI runs, invite sends, and schema mutations.
- Membership safeguards: enforce a single active `owner` per hackathon, allow multiple `admin`/`judge`, and require owner/admin confirmation to transfer or revoke elevated roles.
- Invite lifecycle: tokens expire after 7 days, single-use; expired or used tokens surface clear messaging in UI and email.
- Corpus storage: cap cached Firecrawl corpus at 2 MB per submission, convert to sanitized Markdown, track `crawledAt`, and refresh/purge any corpus older than 30 days.
- AI review workflow: allow a single in-flight review per submission, debounce retries with exponential backoff (up to 3 attempts), and surface terminal failure toasts with retry guidance.

## Outstanding Actions
- Firecrawl + Cloudflare credentials: confirm final env var names (`FIRECRAWL_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_URL`), quota limits, and staging vs. production key usage with official docs/support; document outcomes in `.env.example`, `README.md`, and deployment runbooks.

## Implementation Phases

### 1. Domain Modeling & Schema
- Extend `convex/schema.ts` with `hackathons`, `memberships`, `submissions`, and derived nested fields (AI + source blobs) plus recommended indexes.
- Add branded type aliases in `src/lib/shared` (e.g., `HackathonId`, `SubmissionId`, `IsoDateString`) to maintain type safety through Convex → server → client layers.
- Update any schema-dependent utilities (Convex codegen will emit the new types once `npx convex codegen` runs).
- Encode board status as a string enum constrained to the fixed column list and expose helper utilities for optimistic updates.
- Model membership roles with invariants: exactly one active `owner` per hackathon, multiple `admin`/`judge` allowed, and store invite expirations (7-day default) + hashed tokens.
- Document new env vars (Firecrawl, Cloudflare Gateway, invite token secret, AI model id) in `README.md` and `.env.example` once naming is confirmed.

### 2. Convex Domain Functions
- Create feature-specific Convex modules (`convex/hackathons.ts`, `convex/memberships.ts`, `convex/submissions.ts`, `convex/ai.ts` optional) that encapsulate:
  - `hackathons.listByUser`, `hackathons.create`, `hackathons.update`, `hackathons.getById`.
  - `memberships.listByHackathon`, `memberships.invite`, `memberships.acceptInvite`, `memberships.revoke/remove`, `memberships.resendInvite` (todo optional).
  - `submissions.byHackathon`, `submissions.create`, `submissions.updateStatus`, `submissions.updateAI`.
  - Shared `requireRole(ctx, hackathonId, allowedRoles)` helper that composes with existing Better Auth session retrieval.
- Implement invite-token issuance + validation (generate opaque token, store hashed + expiry, enforce single-use).
- Integrate Convex rate limiter for AI review throttling and invite email resend.
- Ensure mutations emit audit log entries if we need traceability (follow existing `auditLogs` pattern) and enforce membership invariants (single owner, owner/admin confirmation on role downgrades).

### 3. Server Functions & Fetch Clients
- Add `src/features/hackathons/server/**` with `createServerFn` wrappers that call the Convex queries/mutations via `setupFetchClient`.
- Provide loader handlers:
  - `/app/h` → `getHackathonIndexDataServerFn` (list + membership roles).
  - `/app/h/$id` → `getHackathonWorkspaceServerFn` (hackathon metadata + submissions snapshot).
  - `/app/h/$id/judges` → `getJudgeManagementServerFn`.
  - `/app/invite/$token` → `resolveInviteTokenServerFn` (fetch invite context before render).
- Keep server modules pure (only static imports) and funnel any role checks through shared helpers.
- Reuse `requireAuth` for baseline auth; layer role validation per request.
- Surface invite token status (active, expired, used) during loader resolution to drive user messaging without extra client fetches.

### 4. Routing & Navigation
- Update `/app` index route to redirect authenticated users to `/app/h` once hackathon flows ship; preserve admin dashboard under `/app/admin` (guarded by `routeAdminGuard`).
- Implement new route files:
  - `src/routes/app/h.tsx` (list) with loader + pending/error components.
  - `src/routes/app/h/$hackathonId.tsx` for workspace.
  - `src/routes/app/h/$hackathonId/judges.tsx` for judge management.
  - `src/routes/app/invite/$token.tsx` for invite acceptance.
- Add `/app/api.ai.review.ts` (or `/src/routes/app/api.ai.review.ts`) as a server-only route exporting the streaming handler.
- Wire marketing CTA (`MarketingHome` primary button) to `/app` which will land in the auth gate/list.
- Update breadcrumbs/nav once new pages exist (review `PageHeader` usage).
- Note: interactions may assume JavaScript availability; SSR loaders still provide initial render but expect hydration for actions.

### 5. Client Features & UI
- Create a `src/features/hackathons` slice containing:
  - Reusable hooks: `useHackathons`, `useSubmissionBoard`, `useInviteJudge`.
  - UI components: hackathon list grid, empty state modal auto-open, Kanban board (consider `@dnd-kit` or `react-beautiful-dnd`), submission drawer with streaming view, form modals using `@tanstack/react-form`.
  - Shared primitives (role badges, status chips, AI summary card).
- Define board column metadata (ids, titles, colors) as shared constants that match server-enforced statuses.
- Seed Convex `useQuery` hooks with loader data via `useLoaderSeededQuery` (follow dashboard pattern) for instant SSR hydration.
- Implement optimistic updates for creation, status drag/drop, and settings edits; fall back to server snapshot on failure.
- Integrate toasts for invite/resend, AI errors, crawl failures (reusing existing toast system if present).
- Ensure accessibility: focus traps for modals, keyboard DnD fallback, streaming aria-live region.
- Optimize for pointer/touch parity in drag-and-drop interactions; leverage library support (e.g., `dnd-kit`) to cover mobile gestures.

### 6. AI Review Pipeline
- Implement Firecrawl client in `src/lib/server/firecrawl.ts` (static import, configurable base URL + key) to fetch and cache repository/site content.
- Build Cloudflare AI Gateway client (`src/lib/server/ai-gateway.ts`) using Fetch + Vercel AI SDK `streamText`; inject model + account headers from env.
- Server route `/app/api.ai.review`:
  - Validate caller role via Convex before starting.
  - Fetch submission + rubric in parallel using Convex HTTP client.
  - Enforce 1/min rate limit (Convex mutation or rate limiter helper).
  - Kick off Firecrawl if cache missing/expired, sanitize/trim payload, truncate stored corpus to 2 MB Markdown-equivalent before persisting, and invalidate caches older than 30 days to force re-crawls.
  - Stream AI output to client (Server-Sent Events or readable stream) while buffering for final persistence.
  - Require the final chunk to include JSON `{ score: number, summary: string }`; clamp `score` between 0 and 100 and persist `score = null` if parsing fails.
  - Surface structured error payloads for crawl/AI failures; ensure client handles backoff.
- Client drawer listens to stream (e.g., `fetch` with `ReadableStream`) and updates live text; disable Run button while pending, allow retry with exponential backoff (up to 3 attempts) after failures, and display cooldown messaging on rate-limit hits.
- Update UI to render the 0-100 score with contextual badge styling and surface the raw summary markdown when the stream completes.

### 7. Invite Emails & Background Tasks
- Extend the existing email mutation stack in `convex/emails.ts`—the same service/structure used for password reset—to include a hackathon invite template that deep-links to `/app/invite/:token`, keeping copy centrally managed via Resend.
- Default invite email copy:
  ```text
  Subject: You’re invited to judge {{hackathonTitle}}

  Hi {{inviteeNameOrEmail}},

  {{inviterName}} has invited you to join the {{hackathonTitle}} hackathon as a judge.

  Click below to accept your invitation and jump into the workspace:
  {{inviteUrl}}

  This secure link expires in 7 days. If it stops working, ask {{inviterName}} to send a fresh invite.

  See you in the judging panel!
  — The {{productName}} Team
  ```
- Ensure mutation schedules email via Convex scheduler (`ctx.scheduler.runAfter`) and reuses Resend provider configuration.
- Add resend + revoke flows (pending invites) and immediate removal for active judges (status transitions in Convex).
- Update `netlify.toml` and docs if additional Netlify function routing is required; otherwise, document Resend template management and provide local dev stubs.

### 8. AuthZ, Roles, and Guards
- Centralize role resolution: `requireHackathonRoleServerFn` returning membership + hackathon doc for server handlers.
- Treat `owner` as an elevated role equivalent to `admin` for that hackathon; ensure owners/admins can manage invites/settings while judges remain limited to viewing submissions + running AI.
- Apply guards in Convex mutations, server functions, client UI gating (hide buttons when role insufficient).
- Log unauthorized attempts via `auditLogs` when helpful.

### 9. Observability, QA, and DX
- Add feature flag or progress indicator so admin dashboard users are unaffected during rollout.
- Expand Biome lint + TypeScript coverage for new files; ensure `pnpm lint` and `pnpm typecheck` stay green.
- Add lightweight observability: structured `console` logs for server functions, Convex audit entries for critical mutations, and optional integration with existing log drains if available.
- Update docs (`README.md`, new `docs/` entry) with usage instructions, env setup, and operational runbooks.
- Coordinate with infrastructure to confirm Firecrawl/Cloudflare env var names, quota limits, and staging vs. production keys; codify the findings in configuration docs.

### 10. Critical Gaps to Close
1. **Invite token plumbing**
   - Store hashed tokens (`tokenHash`) with 7-day expirations; enforce single use.
   - `/app/invite/:token` loader returns `{ status: 'valid' | 'expired' | 'used', hackathonTitle, inviterName }`.
   - Provide clear UX for invalid tokens with “Ask owner to resend” CTA.
2. **Role guard single source of truth**
   - Implement `requireHackathonRole(hackathonId, allowedRoles)` shared helper returned `{ userId, role, hackathon }`.
   - Mutations enforce single active owner invariant.
3. **Rate limiting & in-flight review lock**
   - Per submission: allow 1 AI review per minute.
   - Maintain `ai.inFlight: boolean` flag set only server-side to block concurrent runs.
4. **Crawl cache lifecycle**
   - Persist `source.corpus` (≤2 MB sanitized Markdown) + `source.crawledAt`.
   - Auto-refresh if cache older than 30 days or when user clicks “Re-crawl”.
5. **Streaming robustness**
   - Handle client aborts gracefully; ensure `submissions.updateAI` executes for every attempt (even empty/failed parses).
   - Retry Gateway 5xx with exponential backoff (max 3 attempts); surface terminal error toast.
6. **Status transition rules**
   - Permit moves only within the four fixed columns.
   - Roll back optimistic DnD state when mutation fails.
7. **404/403/empty states**
   - Provide missing/forbidden hackathon UI, empty submissions CTA (“Add submission”), and empty judges CTA (“Invite judge”).
8. **Env wiring + docs**
   - Wire required env vars for staging/prod: `FIRECRAWL_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_URL`, `AI_MODEL_ID=@cf/meta/llama-3.1-8b-instruct`, `INVITE_TOKEN_SECRET`.
   - Update `.env.example` plus README first-run instructions.

### 11. Route Acceptance Checklist
- **`/` (Marketing)**: Primary CTA routes to `/app`; page renders without console errors and meets Lighthouse basics.
- **`/app` (Auth gate)**: Redirects unauthenticated users to sign-in; authenticated users land on `/app/h`.
- **`/app/h` (Index)**:
  - Lists hackathons with role badges; seeded loader data prevents layout shift.
  - Empty memberships auto-open New Hackathon modal; creation redirects to `/app/h/:id`.
- **`/app/h/:hackathonId` (Workspace)**:
  - Header + actions (`Settings`, `New Submission`, `Invite Judge`, `Manage Judges`).
  - Kanban reflects live Convex query; drag-and-drop reverts on failure.
  - Drawer shows metadata, last AI result; “Run AI Review” handles crawl + stream flow, rate limit messaging, and abort cleanup (`inFlight` reset).
- **`/app/h/:hackathonId/judges`**:
  - Active + Invited lists with role guard restrictions.
  - Invite sends email (toast confirmation) and updates list; revoke/remove/resend respect throttles.
- **`/app/invite/:token`**:
  - Valid tokens attach user, clear token, redirect to workspace.
  - Expired/used tokens show helpful messaging + “Ask owner to resend” link.
- **`/app/api.ai.review`**:
  - Validates membership role, enforces rate limit + in-flight lock.
  - Streams markdown tokens; finalizes persistence even on parse failure; returns structured errors.

### 12. Server Contracts
- **AI Review (`POST /app/api.ai.review`)**
  - Body: `{ sid: string }`
  - Stream: `text/plain` markdown tokens.
  - Finalization: `submissions.updateAI({ sid, summary, score ?? null, lastReviewedAt })`.
  - Error payload: `{ code: 'NO_CORPUS' | 'RATE_LIMIT' | 'CRAWL_FAIL' | 'AI_FAIL', message }` with appropriate HTTP status.
- **Invite acceptance mutation**
  - Input: `{ token: string }`
  - Success: attaches membership to current user, clears token, returns `{ hackathonId }`.
  - Errors: `INVALID`, `EXPIRED`, `USED`.

### 13. Schema Additions (reference)
```ts
// convex/schema.ts
hackathons: defineTable({
  ownerUserId: v.id('users'),
  title: v.string(),
  description: v.optional(v.string()),
  dates: v.optional(v.string()),
  rubric: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
}),
memberships: defineTable({
  hackathonId: v.id('hackathons'),
  userId: v.optional(v.id('users')),
  invitedEmail: v.optional(v.string()),
  role: v.union(v.literal('owner'), v.literal('admin'), v.literal('judge')),
  status: v.union(v.literal('invited'), v.literal('active')),
  tokenHash: v.optional(v.string()),
  tokenExpiresAt: v.optional(v.number()),
  invitedByUserId: v.id('users'),
  createdAt: v.number(),
}).index('byHackathonId', ['hackathonId']).index('byUserId', ['userId']).index('byTokenHash', ['tokenHash']),
submissions: defineTable({
  hackathonId: v.id('hackathons'),
  title: v.string(),
  team: v.string(),
  repoUrl: v.optional(v.string()),
  siteUrl: v.optional(v.string()),
  status: v.union(v.literal('submitted'), v.literal('review'), v.literal('shortlist'), v.literal('winner')),
  source: v.optional(
    v.object({
      corpus: v.optional(v.string()),
      crawledAt: v.optional(v.number()),
    }),
  ),
  ai: v.optional(
    v.object({
      summary: v.optional(v.string()),
      score: v.optional(v.number()),
      lastReviewedAt: v.optional(v.number()),
      inFlight: v.optional(v.boolean()),
    }),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index('byHackathonId', ['hackathonId']).index('byHackathonId_status', ['hackathonId', 'status']);
```

### 14. Suggested Build Order
1. Schema updates, codegen, and shared `requireHackathonRole`.
2. `/app/h` list + New Hackathon modal with auto-open empty state.
3. `/app/h/:hackathonId` workspace shell, Kanban, and modals (settings/new submission/invite).
4. `/app/h/:hackathonId/judges` management page, invite send, invite acceptance route.
5. Firecrawl client, crawl action, corpus storage (with 30-day refresh).
6. `/app/api.ai.review` streaming route + drawer integration + persistence finalization.
7. Rate limiting, in-flight locks, error messaging polish, empty/edge state UX.

## Definition of Done Validation
- `/app/h` uses SSR loader + live Convex query, auto-opens creation modal when empty, and navigates after creation.
- `/app/h/:hackathonId` renders board + drawer, supports DnD with optimistic rollback, AI review streaming, and settings modal.
- `/app/h/:hackathonId/judges` lists active/invited judges, supports invite/revoke/remove/resend with live updates.
- `/app/invite/:token` handles happy path + invalid/expired tokens, attaches current user, redirects to workspace.
- `/app/api.ai.review` enforces auth + rate limits, streams tokens, persists summary/score, and surfaces crawl/AI errors.
- All new flows respect existing auth guards, type safety, and performance guidelines from TanStack Start.
