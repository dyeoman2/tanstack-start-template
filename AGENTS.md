# TanStack Start Agent Guide

## Core Philosophy

- Strong end-to-end type safety (database → server → router → client); no `any` or type casting.
- Server-first, progressively enhanced flows; UI hydrates cleanly but works without JS.
- Performance by design: static imports, parallel data fetching, targeted cache updates.

## Architecture

- `src/routes/`: File-based routes with loaders, guards, pending/error components.
- `src/features/`: Feature slices with UI, hooks, and server functions (`*.server.ts`).
- `src/lib/server/`: Server utilities (database, auth, email, env).
- `src/components/ui/`: Shadcn/ui primitives and shared components.
- Database access via Convex queries/mutations and `setupFetchClient`.

## Golden Rules

- Keep imports static and synchronous inside server modules; no dynamic imports in server functions.
- One server function, one responsibility. Compose higher-level flows by orchestrating smaller server functions.
- Use Convex queries/mutations for data operations with automatic type generation.
- Reuse provided auth guards (`routeAuthGuard`, `routeAdminGuard`, `requireAuth`, `requireAdmin`)—do not reimplement session checks.
- Keep UI components pure; business logic lives in hooks or server functions.
- Never commit files with git unless explicitly requested by the user.

## Key Patterns

### Routes

```ts
export const Route = createFileRoute('/')({
  beforeLoad: routeAuthGuard,
  loader: async () => getDashboardDataServerFn(),
  pendingComponent: DashboardSkeleton,
  errorComponent: DashboardErrorBoundary,
});
```

### Server Functions

```ts
// Parallel queries with discriminated unions
export const getDashboardDataServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const [statsResult, activityResult] = await Promise.allSettled([
    getStats(), getActivity()
  ]);

  // Return discriminated union: success | partial | error
  if (statsResult.status === 'fulfilled' && activityResult.status === 'fulfilled') {
    return { status: 'success', stats: statsResult.value, activity: activityResult.value };
  } else {
    return { status: 'partial', errors: ['Some data failed to load'] };
  }
});

// Input validation with Zod
export const signUpServerFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ email: z.string().email(), password: z.string().min(8) }))
  .handler(async ({ data }) => {
    // Business logic...
    return { success: true };
  });
```

### SSR + Realtime Flow

- Load every route’s critical data through a loader-backed `createServerFn` so the server render includes real data.
- Pass loader results into components via `Route.useLoaderData()` (or props) and keep UI shells pure.
- Subscribe to Convex queries immediately; seed them with loader data (e.g. `liveData ?? initial`) instead of delaying the `useQuery` call.
- Layer Convex `useQuery` calls on top for live updates, using the loader payload as the fallback until subscriptions resolve.

### Database

- Use Convex queries/mutations with automatic type generation.
- Use `setupFetchClient` for server-side Convex operations.
- Schema defined in `convex/schema.ts` with automatic deployment.
- Real-time subscriptions available via Convex React hooks.

### Auth

- Route guards: `routeAuthGuard`, `routeAdminGuard({ location })` in `beforeLoad`.
- Server guards: `requireAuth()`, `requireAdmin()` throw on failure.
- Client auth: `useAuth()` hook from `~/features/auth/hooks/useAuth`.

### Convex Client Hooks

- Use `useQuery(api.xxx)` from `convex/react` for real-time data, seeded with loader data for instant SSR results.
- Use `useMutation(api.xxx)` for mutations with automatic cache updates.
- No manual cache invalidation needed - Convex automatically updates queries when data changes.
- Real-time subscriptions enable live data updates across all connected clients.

### Forms

- Use `@tanstack/react-form` with Zod validation.
- Validate search params with Zod schemas.

### UI

- Build from shadcn/ui components with `cn()` helper.
- Keep components pure; logic in hooks.

### Advanced Patterns

- **Branded Types**: `type IsoDateString = string & { __brand: 'IsoDateString' }`
- **Discriminated Unions**: `{ status: 'success' | 'partial' | 'error' }` for safe error handling
- **Promise.allSettled**: Parallel operations with individual error handling
- **Performance Monitoring**: `usePerformanceMonitoring('RouteName')` for dev logging

## TypeScript & Code Style

### Type Discipline

- Strict mode only. No `any`, narrow `unknown`.
- Use branded types and discriminated unions.
- Derive types from implementations when possible.

### Naming

- Components: `PascalCase.tsx`
- Server functions: `camelCaseServerFn`
- Server modules: `kebab-case.server.ts`
- Use `~/` aliases, no relative imports.

### File Placement

- Routes in `src/routes/`
- Features in `src/features/`
- Shared code in `src/lib/`
- Never edit `routeTree.gen.ts`

## Workflow

### Commands

```bash
pnpm dev             # Dev server
pnpm build           # Build + typecheck
pnpm typecheck       # TypeScript check
pnpm lint            # Lint with Biome
pnpm format          # Format with Biome
npx convex dev       # Start Convex development server
npx convex deploy    # Deploy Convex functions to production
npx convex dashboard # Open Convex dashboard
```

### Development

- Run `pnpm lint` and `pnpm typecheck` before committing.
- Copy `.env.example` to `.env.local` for env vars.
- Use `getEnv()` for server environment variables.
- Server-only files (`.server.ts`) never ship to client.
- **Database workflow**: Edit `convex/schema.ts` → Convex auto-deploys schema changes.

### Security

- Never expose secrets to client-side code.
- Rate-limit user-triggered server functions.

## Anti-patterns

- ❌ Dynamic imports in server functions (hurts performance)
- ❌ Data waterfalls (loader + client fetch = multiple roundtrips)
- ❌ Mixed concerns in server functions (db + email + analytics together)
- ❌ `window.location.href` navigation (use `useRouter().navigate()`)
- ❌ Manual cache invalidation (Convex handles this automatically)
- ❌ Direct database access in client components (use Convex queries/mutations)

## Quick Checklist

- ✅ Server functions in `*.server.ts` with Zod validation
- ✅ Route loaders fetch all data in parallel
- ✅ Loader data passed into components and reused as fallbacks for Convex hooks
- ✅ Auth guards in `beforeLoad` and server functions
- ✅ Convex queries/mutations for client-side data access
- ✅ Components pure, logic in hooks
- ✅ TypeScript strict mode, no `any`
- ✅ Static imports, no dynamic imports in server
- ✅ Database via Convex queries/mutations
- ✅ Database schema in `convex/schema.ts` with auto-deployment
- ✅ Never commit files with git unless explicitly requested

Follow these patterns for TanStack Start consistency.
