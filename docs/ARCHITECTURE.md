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
  pendingMs: 150,
  pendingMinMs: 250,
  pendingComponent: () => <AppLayoutSkeleton />,
  component: AppLayout,
});

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isPending } = useAuth();
  const redirectRef = useRef(false);
  const redirectTarget = location.href ?? '/app';

  useEffect(() => {
    if (isPending) return;
    if (isAuthenticated) {
      redirectRef.current = false;
      return;
    }
    if (redirectRef.current) return;

    redirectRef.current = true;
    void navigate({
      to: '/login',
      search: { redirect: redirectTarget },
      replace: true,
    }).catch(() => {
      redirectRef.current = false;
    });
  }, [isAuthenticated, isPending, navigate, redirectTarget]);

  if (isPending || !isAuthenticated) {
    return <AppLayoutSkeleton />;
  }

  return <Outlet />;
}
```

---

## 3. Server Functions

The application uses two types of server functions with different purposes:

### 3.1 TanStack Start Server Functions

- **Location**: `src/features/*/server/*.ts` (regular `.ts` files, not `.server.ts`)
- **Purpose**: Route loaders, actions, form handlers, and API endpoints
- **Technology**: TanStack Start's `createServerFn()` with Zod validation
- **Examples**: User registration, email sending, route guards

```ts
// src/features/auth/server/user-management.ts
export const signUpWithFirstAdminServerFn = createServerFn({ method: 'POST' })
  .inputValidator(signUpWithFirstAdminSchema)
  .handler(async ({ data }) => {
    // Implementation with access to secrets and server-side APIs
  });
```

### 3.2 Convex Functions

- **Location**: `convex/*.ts`
- **Purpose**: Database operations, real-time subscriptions, data mutations
- **Technology**: Convex's query/mutation/action system
- **Examples**: User profile management, dashboard data, RBAC enforcement

```ts
// convex/users.ts
export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    // Database operations with automatic type generation
  }
});
```

### 3.3 Key Differences

| Aspect | TanStack Start Server Functions | Convex Functions |
|--------|-------------------------------|------------------|
| **Execution Context** | Node.js server | Convex cloud runtime |
| **Database Access** | Via Convex client (`setupFetchClient`) | Direct database access |
| **Real-time** | No | Yes (subscriptions) |
| **Caching** | Manual | Automatic (Convex) |
| **Secrets Access** | Yes | No (security boundary) |
| **File Extension** | `.ts` | `.ts` |

---

## 4. Authentication & Session Handling

### 4.1 Better Auth Client Integration

- Client SDK created once in `src/features/auth/auth-client.ts`.
- Re-exports `signIn`, `signOut`, and `useSession` while keeping access to the underlying `authClient` for lower-level helpers (e.g. `authClient.getSession()` in `setupClaimRefresh`).

```ts
// src/features/auth/auth-client.ts
export const authClient = createAuthClient({
  plugins: [convexClient()],
});
export const { signIn, signOut, useSession } = authClient;
```

### 4.2 Lightweight Auth State Hook

`useAuthState()` provides basic authentication status without database calls.

```ts
// src/features/auth/hooks/useAuthState.ts
export function useAuthState(): AuthState {
  const { data: session, isPending, error } = useSession();
  return {
    isAuthenticated: !!session?.user,
    isPending,
    error,
    userId: session?.user?.id,
  };
}
```

### 4.3 Role-Aware Auth Hook

`useAuth()` conditionally fetches role data using `'skip'` so Convex is only queried once a session exists, keeping hook order stable without unnecessary requests.

```ts
// src/features/auth/hooks/useAuth.ts
export function useAuth(options: AuthOptions = {}): AuthResult {
  const { fetchRole = true } = options;

  const authState = useAuthState();
  const { data: session, isPending: sessionPending, error } = useSession();

  const shouldFetchProfile = authState.isAuthenticated && !sessionPending && fetchRole;

  // Skip Convex query until a session exists to keep hooks stable without extra requests
  const profileQuery = useQuery(api.users.getCurrentUserProfile, shouldFetchProfile ? {} : 'skip');
  const profile = shouldFetchProfile ? profileQuery : undefined;

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    console.log('[useAuth]', {
      authenticated: authState.isAuthenticated,
      pending: sessionPending || (shouldFetchProfile && profile === undefined),
      role: shouldFetchProfile ? profile?.role : 'not-fetched',
      userId: `${session?.user?.id?.slice(0, 8)}...`,
      hasError: !!error,
    });
  }, [
    authState.isAuthenticated,
    sessionPending,
    shouldFetchProfile,
    profile?.role,
    profile,
    error,
    session?.user?.id,
  ]);

  const isPending =
    sessionPending || (authState.isAuthenticated && shouldFetchProfile && profile === undefined);

  const role: UserRole = shouldFetchProfile
    ? profile?.role === USER_ROLES.ADMIN
      ? USER_ROLES.ADMIN
      : USER_ROLES.USER
    : DEFAULT_ROLE;

  return useMemo(
    () => ({
      user: session?.user
        ? {
            ...session.user,
            role,
            phoneNumber: shouldFetchProfile ? profile?.phoneNumber || null : null,
          }
        : null,
      isAuthenticated: authState.isAuthenticated,
      isAdmin: role === USER_ROLES.ADMIN,
      isPending,
      error,
    }),
    [
      session?.user,
      role,
      profile?.phoneNumber,
      authState.isAuthenticated,
      isPending,
      error,
      shouldFetchProfile,
    ],
  );
}
```

> **Note:** Passing `'skip'` keeps hook order consistent while avoiding Convex traffic when no session is present.

### 4.4 Claim Refresh Helper

We refresh Better Auth claims when the window regains focus so role changes on the server propagate quickly without forcing a full reload.

```ts
// src/lib/roleRefresh.ts
import { authClient } from '~/features/auth/auth-client';

export function setupClaimRefresh(maxAgeMs = 20 * 60_000) {
  if (typeof window === 'undefined') return () => {};

  const maybeRefresh = async () => {
    if (!authClient.getSession) return;
    try {
      const snapshot = await authClient.getSession();

      // Safe property access with type guards
      if (!snapshot || typeof snapshot !== 'object') return;

      const user = (snapshot as Record<string, unknown>).user;
      if (!user || typeof user !== 'object') return;

      const userObj = user as Record<string, unknown>;
      const lastRefreshedAt =
        typeof userObj.lastRefreshedAt === 'number' ? userObj.lastRefreshedAt : 0;

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

## 5. RBAC & Capability Enforcement

### 5.1 Capability Map

Single source of truth for role → capability mapping. Role validation is enforced at the database level using Convex enums.

```ts
// convex/authz/policy.map.ts
export const Caps = {
  'route:/app': ['user', 'admin'],           // Authenticated users
  'route:/app/admin': ['admin'],             // Admin-only routes
  'route:/app/admin.users': ['admin'],       // User management
  'route:/app/admin.stats': ['admin'],       // System statistics
  'route:/app/profile': ['user', 'admin'],   // Profile access
  'user.write': ['admin'],                   // User role management
  'user.bootstrap': ['public', 'user', 'admin'], // Bootstrap (logic-restricted)
  'profile.read': ['user', 'admin'],         // Read own profile
  'profile.write': ['user', 'admin'],        // Update own profile
  'util.firstUserCheck': ['public', 'user', 'admin'], // Public utilities
  'util.emailServiceStatus': ['public', 'user', 'admin'],
  'dashboard.read': ['admin'],               // Admin dashboard access
} as const;

export const PublicCaps = new Set<Capability>([
  'util.firstUserCheck',
  'util.emailServiceStatus',
  'user.bootstrap', // Bootstrap capability available to all
]);
```

### 5.1.1 Database Schema with Enum Validation

```ts
// convex/schema.ts - Database-level enum validation
userProfiles: defineTable({
  userId: v.string(), // References Better Auth user.id
  role: v.union(v.literal('user'), v.literal('admin')), // Enforced enum
  createdAt: v.number(),
  updatedAt: v.number(),
})
```

**Benefits:**

- **Database-level validation** prevents invalid roles
- **Type-safe** - Generated Convex types ensure consistency
- **Performance** - No application-level validation overhead

### 5.2 Guard Wrapper

Most Convex queries, mutations, and actions are exported via `guarded.*`, which enforces capability-based access control before executing handlers. A few functions stay outside the guard system for explicit reasons:

- `users.getUserCount` – remains public so bootstrap flows can detect the first user before any session exists.
- `dashboard.getDashboardData` – stays a plain query to return `null` for non-admins, allowing the dashboard route to render a friendly fallback rather than tripping the error boundary.
- `auth.rateLimitAction` – exposed as a public action but protected by the shared Better Auth secret so server utilities can invoke it across the HTTP boundary.
- `users.getUserProfile` – defined with `internalQuery`, keeping profile lookups internal while still supporting guard resolution.
- `users.updateCurrentUserProfile` – stays a plain mutation because Better Auth enforces the session, and the handler only updates the caller’s own record.

```ts
// convex/authz/guardFactory.ts (excerpt)
export const guarded = {
  query: <Args, Result>(cap: Capability, args: Args, handler) => {
    return query({
      args,
      handler: async (ctx, args) => {
        const role = await resolveRole(ctx, cap);
        return handler(ctx, args, role);
      },
    });
  },
  // mutation/action analogous...
};
```

**Role Resolution Logic:**

```ts
async function resolveRole(ctx, cap: Capability) {
  // Check if capability is public
  if (PublicCaps.has(cap)) {
    return 'public';
  }

  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error(`Authentication required for capability: ${cap}`);
  }

  const userId = assertUserId(authUser, 'User ID not found');

  let profile: { role?: string } | null = null;
  if ('db' in ctx) {
    profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
  } else {
    profile = await ctx.runQuery(internal.users.getUserProfile, { userId });
  }

  const role = profile?.role || 'user';
  const allowedRoles = Caps[cap] ?? [];
  if (!allowedRoles.some((allowedRole) => allowedRole === role)) {
    throw new Error(`Insufficient permissions for capability: ${cap}`);
  }

  return role;
}
```

### 5.3 Client-Side RBAC Enforcement

**Direct Admin Checks:**

```tsx
// Navigation components use direct admin checks
const authState = useAuthState(); // No DB calls
const { isAdmin } = useAuth({ fetchRole: authState.isAuthenticated });

// Conditional rendering using isAdmin
{isAdmin && <AdminButton />}
```

**Performance Optimization:**

- **Public pages:** Zero DB hits
- **Auth pages:** Zero DB hits
- **Dashboard:** 1 DB hit per session (cached)
- **Navigation:** Zero DB hits (uses cached auth state)

### 5.4 Sample Convex Functions

**Admin Operations:**

`convex/admin.ts` keeps all privileged flows behind the guard wrappers. For example, `getAllUsers` calls `guarded.query('route:/app/admin.users', …)` and then:

- Pages through `userProfiles` using indexed queries (`by_role_createdAt`) to minimise scans.
- Fetches the matching Better Auth documents for the current page only (`fetchBetterAuthUsersByIds`).
- Merges the two data sources and applies in-memory sort/search before returning pagination metadata.

`updateBetterAuthUser` follows the same pattern with `guarded.mutation('user.write', …)` to ensure only admins can update Better Auth user records.

**Bootstrap Operations:**

`convex/users.ts` uses `guarded.mutation('user.bootstrap', …)` for bootstrap logic so we can allow the first profile to be created without an authenticated admin while still requiring admin role for subsequent changes.

`convex/dashboard.ts` keeps `getDashboardData` as a plain Convex `query` so non-admin callers receive `null` instead of a thrown authorization error—the dashboard UI listens for that `null` and shows a friendly fallback. The capability map still marks `dashboard.read` as admin-only so client UI can hide admin affordances.


### 5.6 Route Guards

Server-side route guards use capability-based validation before page loads.

```ts
// src/features/auth/server/route-guards.ts
export async function routeAdminGuard({
  location,
}: {
  location: ParsedLocation;
}): Promise<RouterAuthContext> {
  try {
    const { user } = await getCurrentUserServerFn();

    // Use capability-based checking for consistency with the RBAC system
    const adminCapability: Capability = 'route:/app/admin';
    const allowedRoles = Caps[adminCapability] ?? [];
    if (!user?.role || !(allowedRoles as readonly string[]).includes(user.role)) {
      throw redirect({ to: '/login', search: { reset: '', redirect: location.href } });
    }

    return { authenticated: true, user };
  } catch (_error) {
    throw redirect({ to: '/login', search: { redirect: location.href } });
  }
}

// Usage in admin routes
// src/routes/app/admin/_layout.tsx
export const Route = createFileRoute('/app/admin/_layout')({
  beforeLoad: routeAdminGuard, // Uses capability-based checking
});
```

### 5.6.1 Redirect Patterns

The application uses two different redirect patterns depending on the context:

**Throwing Redirects (Server Guards):**

- Used in `beforeLoad` route guards for immediate route blocking
- Throws a redirect response that TanStack Router catches and handles
- Best for: Admin-only routes, capability-gated pages, strict access control
- Example: `routeAdminGuard` throws redirect to `/login` when access is denied

**Effect-Driven Redirects (Layout Guards):**

- Used in authenticated app layouts for smooth navigation without full page reloads
- Uses `useEffect` + `navigate()` for client-side routing
- Best for: Main app areas, authenticated user flows, preserving navigation state
- Example: `/app` layout redirects unauthenticated users to `/login` while maintaining pending states

Choose the pattern based on whether you want immediate blocking (throwing) or smooth UX transitions (effect-driven).

## Adding New Capabilities

1. Extend the `Capability` union in `convex/authz/policy.map.ts` and update the `Caps` mapping with the roles that should gain access. Only add entries to `PublicCaps` when the capability should bypass authentication entirely.
2. Wrap new Convex handlers with the appropriate `guarded.query/mutation/action` helper so role resolution stays centralised.
3. If a route requires the new capability, create a server guard that mirrors `routeAdminGuard` (`requireAuth` + capability check) and attach it via `beforeLoad`.
4. Use direct role checks (e.g., `isAdmin` from `useAuth()`) so the UI reflects the same capability decisions on the client.

## Performance Characteristics

| Scenario | Convex traffic | Notes |
|----------|----------------|-------|
| Public/auth marketing routes | None | `useAuthState()` only; no Convex hooks run |
| App shell guard | 1 cached query | `useAuth` always calls `api.users.getCurrentUserProfile`; unauthenticated sessions get a fast `null` |
| Admin dashboard load | 1 guarded query | `api.dashboard.getDashboardData` returns data only for admins |
| SPA navigation | Subscription reuse | Convex keeps previous queries hot; no extra loaders |
| Role changes | Auto-invalidation | Convex subscriptions refresh affected queries automatically |

## Best Practices

### Capability Naming Conventions

- **Routes**: `route:/path` (e.g., `route:/app/admin`)
- **Data Operations**: `resource.action` (e.g., `user.write`, `profile.read`)
- **Utilities**: `util.functionName` (e.g., `util.emailServiceStatus`)

### Role Design

- Keep roles simple: only `user` and `admin`
- Use capabilities for fine-grained permissions
- Database enum validation prevents invalid roles

### Error Handling

```ts
try {
  await ctx.runMutation(api.users.updateUserRole, args);
} catch (error) {
  if (error.message.includes('Insufficient permissions')) {
    // Handle permission denied gracefully
    throw new Error('You do not have permission to modify user roles');
  }
  throw error;
}
```

### Testing

```ts
// Test capability enforcement
describe('updateUserRole', () => {
  it('requires user.write capability', async () => {
    // Test with different user roles
  });

  it('allows admins to update user roles', async () => {
    // Test positive authorization
  });
});
```

## Troubleshooting

### Common Issues

**"Authentication required" errors:**

- Ensure user is authenticated before calling protected functions
- Check Better Auth session validity
- Verify route guards are properly configured

**"Insufficient permissions" errors:**

- Verify capability is granted to user's role in `policy.map.ts`
- Check capability spelling and naming consistency
- Ensure role is correctly set in user profile
- Confirm database schema enum validation

**Performance issues:**

- Use `useAuthState()` for lightweight auth checks
- Enable role fetching only when needed with `fetchRole` option
- Check Convex query caching is working properly
- Monitor network tab for unexpected DB calls

### Debug Mode

Enable detailed logging in development:

```bash
VITE_DEBUG=true pnpm dev
```

This provides logging for:

- Authentication state changes
- Capability resolution
- Role validation
- Performance metrics

---

## 7. RBAC Performance & Security

### 7.1 Database Hit Optimization

The RBAC system is designed to minimize database queries while maintaining security and real-time updates:

- **Public/Auth pages:** 0 DB hits (uses lightweight auth state)
- **Dashboard initial load:** 1 DB hit for role data (Convex cached)
- **Subsequent navigation:** 0 DB hits (Convex caching preserves role data)
- **Role changes:** Automatic cache invalidation via Convex subscriptions

### 7.2 Security Layers

1. **Route Guards** (Server) - Pre-load validation
2. **Convex Guards** (Server) - Database operation validation
3. **UI Components** (Client) - Conditional rendering
4. **Bootstrap Logic** (Server) - Special case handling

### 7.3 Real-time Role Updates

- Convex subscriptions automatically invalidate cached role data
- UI updates immediately when roles change
- No manual cache invalidation required

---

## 8. Data Access & Real-Time Updates

### 8.1 Dashboard Example

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

### 8.2 Convex Client Setup

```ts
// src/lib/convexClient.ts
const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.VITE_CONVEX_SITE_URL;
export const convexClient = new ConvexReactClient(convexUrl, { expectAuth: true });
```

Servers call Convex through `setupFetchClient` for authenticated operations (`src/features/auth/server/user-management.ts`).

---

## 9. Error Handling & UX

- Custom error boundaries (`src/components/RouteErrorBoundaries.tsx`) ignore redirect responses to avoid logging noise.
- Skeleton components at route level for perceived performance (`AppLayoutSkeleton`, `AuthSkeleton`, etc.).
- Navigation components use optimized auth hooks to minimize DB hits while showing admin features appropriately.

---

## 10. Environment & Secrets

- `README.md` documents the `ROOT_ADMINS` override to guarantee at least one admin.
- Server-only modules (`*.server.ts`) guard against leaking secrets client-side.

---

## 11. Tooling & Quality Gates

- `pnpm fix` runs Biome formatting and linting.
- `pnpm typecheck` ensures type safety.
- Convex guard wrappers ensure all privileged operations require proper authorization.

---

## 12. RBAC Architecture Summary

### RBAC Performance Characteristics

- **Zero DB hits** on public/auth pages through lightweight auth state
- **Single cached query** per authenticated session for role data
- **Zero DB hits** during dashboard navigation via Convex caching
- **Real-time role updates** via automatic Convex cache invalidation

### Security Architecture

- **Capability-based** authorization with granular permissions
- **Multi-layer validation**: Route → Database → UI
- **Bootstrap protection** with strict first-user logic
- **Type-safe** role checking throughout the stack

### Key Components

- `useAuthState()` - Lightweight auth status (no DB)
- `useAuth()` - Role-aware auth with conditional fetching
- `guarded.*` - Server-side capability enforcement
- Route guards - Pre-load security validation

### Key Benefits

- ✅ **Performance optimized** - minimal database overhead through conditional fetching
- ✅ **Security enhanced** - consistent capability-based authorization across all layers
- ✅ **Maintainable** - single source of truth for permissions in capability map
- ✅ **Real-time** - automatic cache invalidation when roles change

---

## 13. Bootstrap Flow - First Admin User Creation

The application implements a secure bootstrap mechanism to ensure at least one admin user exists without compromising security.

### 13.1 Bootstrap Process Overview

1. **First User Detection**: Check if any user profiles exist in the database
2. **Automatic Admin Assignment**: First user to register gets admin role automatically
3. **Security Lockdown**: Bootstrap capability becomes unavailable once any user exists

### 13.2 Implementation Details

**Server Function (TanStack Start):**

```ts
// src/features/auth/server/user-management.ts
export const signUpWithFirstAdminServerFn = createServerFn({ method: 'POST' })
  .inputValidator(signUpWithFirstAdminSchema)
  .handler(async ({ data }) => {
    // 1. Check user count via Convex
    const userCountResult = await fetchQuery(api.users.getUserCount, {});
    const isFirstUser = userCountResult.isFirstUser;

    // 2. Create user via Better Auth HTTP API
    const signUpResponse = await fetch(`${convexSiteUrl}/api/auth/sign-up/email`, {
      // ... user creation
    });

    // 3. Set role via Convex (admin for first user, user for others)
    const roleToSet = isFirstUser ? USER_ROLES.ADMIN : USER_ROLES.USER;
    await fetchMutation(api.users.setUserRole, {
      userId: signUpResult.user.id,
      role: roleToSet,
      allowBootstrap: isFirstUser, // Bootstrap flag for first admin
    });
  });
```

**Convex Bootstrap Logic:**

```ts
// convex/users.ts
export const setUserRole = guarded.mutation('user.bootstrap', { ... }, async (ctx, args, role) => {
  if (!args.allowBootstrap) {
    // Non-bootstrap: require admin role
    if (role !== 'admin') {
      throw new Error('Admin privileges required for role management');
    }
  } else {
    // BOOTSTRAP: Allow only when no other user profiles exist
    const existingProfiles = await ctx.db.query('userProfiles').collect();
    const nonBootstrapProfile = existingProfiles.find(
      (profile) => profile.userId !== args.userId,
    );

    if (nonBootstrapProfile) {
      throw new Error('Bootstrap not allowed - another user profile already exists');
    }
  }

  // Create/update user profile with role
  // ...
});
```

### 13.3 Security Features

- **Idempotent**: Safe to retry bootstrap operations for the same user
- **Race Condition Protection**: Bootstrap window closes immediately when first profile is created
- **Rate Limiting**: Server-side rate limiting prevents abuse
- **Capability-Based**: Uses `user.bootstrap` capability available to all roles but with logic restrictions

### 13.4 Bootstrap States

| State | User Profiles Exist | Bootstrap Allowed | Role Assigned |
|-------|-------------------|-------------------|----------------|
| **Initial** | 0 | ✅ Yes | `admin` |
| **Normal** | 1+ | ❌ No | `user` |

### 13.5 Error Handling

- **Bootstrap Race Conditions**: Protected by database-level checks
- **Role Assignment Failures**: Logged but don't fail signup (can be fixed manually)
- **Rate Limiting**: Clear error messages with retry times

---

This overview should help reviewers trace decisions from routing all the way to server functions and RBAC enforcement. Update it whenever major architectural choices change.
