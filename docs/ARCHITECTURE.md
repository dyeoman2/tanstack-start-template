# TanStack Start + Convex Architecture Overview

This document captures the current architecture so other agents (human or AI) can review implementation and design trade‑offs quickly.

---

## 1. High-Level Goals

- **Marketing shell (SSG)**: `/` and other public routes render as static markup with optional hydration.
- **Application shell (SPA)**: `/app` and children rely on client-side rendering with Convex real-time queries.
- **End-to-end type safety**: shared types, generated Convex APIs, strict TypeScript across server and client.
- **Server-only logic**: all data mutations and privileged reads happen inside Convex functions or server modules.
- **Role-based access control (RBAC)**: capabilities enumerated once and enforced in server functions + client UX checks.

---

## 2. Routing Strategy

### 2.1 Marketing & Auth

- Located under `src/routes/*.tsx`.
- `staticData: true` for SSG and fast first paint (e.g. `src/routes/index.tsx`).
- Auth pages use client-side session awareness to redirect authenticated users.
- Never import `*.server.ts` modules (or anything touching secrets) into these SSG routes; keep server-only concerns behind dedicated server files.

```tsx
// src/routes/login.tsx (excerpt)
export const Route = createFileRoute('/login')({
  staticData: true,
  component: LoginPage,
});

function LoginPage() {
  const { isAuthenticated, isPending } = useAuth();
  if (isPending) return <AuthSkeleton />;
  if (isAuthenticated) throw redirect({ to: '/app' });
  // ...
}
```

### 2.2 Application Area

- `/app` is SPA: no loaders, everything fetched via Convex hooks.
- Layout guard uses client session to reroute unauthenticated users.

```tsx
// src/routes/app.tsx
export const Route = createFileRoute('/app')({
  pendingComponent: () => <AppLayoutSkeleton />,
  component: AppLayout,
});

function AppLayout() {
  const { isAuthenticated, isPending } = useAuth();
  if (isPending) return <AppLayoutSkeleton />;
  if (!isAuthenticated) throw redirect({ to: '/login', search: { redirect: '/app' } });
  return <Outlet />;
}
```

---

## 3. Authentication & Session Handling

### 3.1 Better Auth Client Integration

- Client SDK created once in `src/features/auth/auth-client.ts`.
- Exposes `useSession` for hooks; session typing extended via `src/types/auth.d.ts`.

```ts
// src/features/auth/auth-client.ts
export const authClient = createAuthClient({
  plugins: [convexClient()],
});
export const { signIn, signOut, useSession, getSession } = authClient;
```

### 3.2 Derived Auth Hook

`useAuth()` fetches role from Convex database (not session) and returns convenience booleans. Only queries when authenticated to avoid unnecessary database calls.

```ts
// src/features/auth/hooks/useAuth.ts
export function useAuth() {
  const { data: session, isPending: sessionPending, error } = useSession();

  const isAuthenticated = !!session?.user;
  const shouldFetchProfile = isAuthenticated && !sessionPending;

  // Only call useQuery when we actually want to fetch to avoid invalid args
  const profile = shouldFetchProfile
    ? useQuery(api.users.getCurrentUserProfile, {})
    : undefined;

  const isPending = sessionPending || (isAuthenticated && profile === undefined);
  const role: UserRole = (profile?.role === 'admin' ? 'admin' : 'user') as UserRole;

  return {
    user: session?.user
      ? {
          ...session.user,
          role,
          phoneNumber: profile?.phoneNumber || null,
        }
      : null,
    isAuthenticated,
    isAdmin: role === 'admin',
    isPending,
    error,
  };
}
```

### 3.3 Claim Refresh Helper

We refresh Better Auth claims when the window regains focus so role changes on the server propagate quickly without forcing a full reload.

```ts
// src/lib/roleRefresh.ts
import { authClient } from '~/features/auth/auth-client';

export function setupClaimRefresh(maxAgeMs = 5 * 60_000) {
  if (typeof window === 'undefined') return () => {};

  const maybeRefresh = async () => {
    if (!authClient.getSession) return;
    try {
      const snapshot = await authClient.getSession();
      const lastRefreshedAt = snapshot?.user?.lastRefreshedAt ?? 0;
      if (Date.now() - lastRefreshedAt > maxAgeMs) {
        await authClient.getSession();
      }
    } catch (error) {
      console.warn('[claim-refresh] Failed to refresh claims', error);
    }
  };

  window.addEventListener('focus', maybeRefresh);
  setTimeout(() => {
    void maybeRefresh();
  }, 0);

  return () => window.removeEventListener('focus', maybeRefresh);
}
```

`AuthProvider` wires this up once on mount via a `useEffect`.

---

## 4. RBAC & Capability Enforcement

### 4.1 Capability Map

Single source of truth for role → capability mapping. Includes `public` for unauthenticated calls where needed.

```ts
// convex/authz/policy.map.ts
export const Caps = {
  'route:/app/admin.users': ['admin'],
  'user.write': ['admin'],
  'profile.read': ['user', 'staff', 'admin'],
  'util.firstUserCheck': ['public', 'user', 'staff', 'admin'],
} as const;
export const PublicCaps = new Set<Capability>([
  'util.firstUserCheck',
  'util.emailServiceStatus',
]);
```

### 4.2 Guard Wrapper

All Convex queries/mutations/actions are exported via `guarded.*`. The helper infers argument types and enforces roles before calling the actual handler.

```ts
// convex/authz/guardFactory.ts (excerpt)
export const guarded = {
  query(cap, args, handler) {
    return query({
      args,
      handler: async (ctx, ...payload) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, payload[0], role);
      },
    });
  },
  // mutation/action analogous...
};
```

### 4.3 Sample Convex Function

```ts
// convex/admin.ts (excerpt)
export const getAllUsers = guarded.query(
  'route:/app/admin.users',
  { page: v.number(), pageSize: v.number(), /* ... */ },
  async (ctx, args) => {
    const paginatedProfiles = await ctx.db.query('userProfiles').paginate({ cursor: args.cursor, numItems: args.pageSize });
    // Combine with Better Auth data...
    return { users: combinedUsers, pagination: { /* ... */ } };
  },
);
```

### 4.4 Client Capability Checks

Use the generated Convex API or simple session role checks for conditional rendering.

```tsx
// src/lib/Allowed.tsx
export function Allowed({ cap, children }: AllowedProps) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const allowedRoles = Caps[cap] ?? [];
  if (!role || !allowedRoles.includes(role)) return null;
  return <>{children}</>;
}
```

For route guards, we pair capability checks with redirect logic:

```ts
// src/routes/app/admin/_layout.tsx
beforeLoad: async () => {
  if (import.meta.env.SSR) return; // SPA guard only
  const { allowed, reason } = await ensureAllowed('route:/app/admin.users');
  if (!allowed) {
    throw redirect({ to: reason === 'unauthenticated' ? '/login' : '/app' });
  }
},
```

---

## 5. Data Access & Real-Time Updates

### 5.1 Dashboard Example

- Loader removed; page fetches via Convex `useQuery` and handles the `undefined` (pending) state.

```tsx
// src/routes/app/index.tsx
export const Route = createFileRoute('/app/')({
  staleTime: 30_000,
  gcTime: 120_000,
  component: DashboardComponent,
});

function DashboardComponent() {
  const dashboardData = useQuery(api.dashboard.getDashboardData, {});
  return <Dashboard data={dashboardData ?? null} isLoading={dashboardData === undefined} />;
}
```

### 5.2 Convex Client Setup

```ts
// src/lib/convexClient.ts
const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.VITE_CONVEX_SITE_URL;
export const convexClient = new ConvexReactClient(convexUrl, { expectAuth: true });
```

Servers call Convex through `setupFetchClient` for authenticated operations (`src/features/auth/server/user-management.ts`).

---

## 6. Error Handling & UX

- Custom error boundaries (`src/components/RouteErrorBoundaries.tsx`) ignore redirect responses to avoid logging noise.
- Skeleton components at route level for perceived performance (`AppLayoutSkeleton`, `AuthSkeleton`, etc.).
- Navigation components use `useAuth` to tailor menu entries, e.g. showing the Admin link only to admins.

---

## 7. Environment & Secrets

- `.env.example` enumerates required keys.
- `README.md` documents the `ROOT_ADMINS` override to guarantee at least one admin.
- Server-only modules (`*.server.ts`) guard against leaking secrets client-side.

---

## 8. Tooling & Quality Gates

- `pnpm fix` runs Biome formatting and linting.
- `pnpm typecheck` ensures type safety.
- `node tools/eslint-guarded-convex-exports.js` confirms all Convex exports go through the guard helper.

---

## 9. Known Edge Cases / TODOs

- Ensure Better Auth session payloads always include the user role so UI checks remain consistent.
- Convex dev tooling (`npx convex dev --once`) requires network access; in network-restricted CI this may need stubbing.
- Additional capabilities should be documented and added to `Caps` + `PublicCaps` as features grow.

---

This overview should help reviewers trace decisions from routing all the way to server functions and RBAC enforcement. Update it whenever major architectural choices change. 
