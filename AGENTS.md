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
- Database access via `getDb()` singleton from Drizzle.

## Golden Rules

- Keep imports static and synchronous inside server modules; no dynamic imports in server functions.
- One server function, one responsibility. Compose higher-level flows by orchestrating smaller server functions.
- Prefer route loaders for initial data and hydrate React Query with `initialData` instead of cascading client fetches.
- Use shared query key factories and invalidators from `~/lib/query-keys` when reading or invalidating cache.
- Reuse provided auth guards (`routeAuthGuard`, `routeAdminGuard`, `requireAuth`, `requireAdmin`)—do not reimplement session checks.
- Keep UI components pure; business logic lives in hooks or server functions.

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

### Database
- Use `const db = getDb()` singleton with explicit projections.
- Leverage Drizzle expressions for server-side filtering.

### Auth
- Route guards: `routeAuthGuard`, `routeAdminGuard({ location })` in `beforeLoad`.
- Server guards: `requireAuth()`, `requireAdmin()` throw on failure.
- Client auth: `useAuth()` hook from `~/features/auth/hooks/useAuth`.

### React Query
- Query keys from `~/lib/query-keys.ts` with factories and invalidators.
- Hydrate with loader data: `useQuery({ initialData: Route.useLoaderData() })`.
- Invalidate precisely using helpers like `queryInvalidators.admin.users.detail(queryClient, userId)`.

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
pnpm db:migrate      # Run migrations
pnpm db:studio       # Database UI
pnpm seed            # Seed data
```

### Development
- Run `pnpm lint` and `pnpm typecheck` before committing.
- Copy `.env.example` to `.env.local` for env vars.
- Use `getEnv()` for server environment variables.
- Server-only files (`.server.ts`) never ship to client.

### Security
- Never expose secrets to client-side code.
- Rate-limit user-triggered server functions.

## Anti-patterns

- ❌ Dynamic imports in server functions (hurts performance)
- ❌ Data waterfalls (loader + client fetch = multiple roundtrips)
- ❌ Mixed concerns in server functions (db + email + analytics together)
- ❌ `window.location.href` navigation (use `useRouter().navigate()`)
- ❌ Broad query invalidation (`queryClient.invalidateQueries()`)

## Quick Checklist

- ✅ Server functions in `*.server.ts` with Zod validation
- ✅ Route loaders fetch all data in parallel
- ✅ Auth guards in `beforeLoad` and server functions
- ✅ Query keys from `~/lib/query-keys.ts`
- ✅ Components pure, logic in hooks
- ✅ TypeScript strict mode, no `any`
- ✅ Static imports, no dynamic imports in server
- ✅ Database via `getDb()` singleton

Follow these patterns for TanStack Start consistency.
