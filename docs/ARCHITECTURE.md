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

### 3.2 Lightweight Auth State Hook

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

### 3.3 Role-Aware Auth Hook

`useAuth()` fetches role data from Convex when needed. Uses conditional fetching to minimize database hits.

```ts
// src/features/auth/hooks/useAuth.ts
export function useAuth(options: AuthOptions = {}): AuthResult {
  const { fetchRole = true } = options;

  const authState = useAuthState();
  const shouldFetchProfile = authState.isAuthenticated && fetchRole;

  // Always call useQuery to maintain hooks order - server returns null for unauthenticated
  const profileQuery = useQuery(api.users.getCurrentUserProfile, {});
  const profile = shouldFetchProfile ? profileQuery : undefined;

  const role: UserRole = shouldFetchProfile
    ? ((profile?.role === 'admin' ? 'admin' : 'user') as UserRole)
    : 'user';

  return {
    user: session?.user ? {
      ...session.user,
      role,
      phoneNumber: shouldFetchProfile ? (profile?.phoneNumber || null) : null,
    } : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: role === 'admin',
    isPending: sessionPending || (authState.isAuthenticated && shouldFetchProfile && profile === undefined),
    error,
  };
}
```

### 3.4 Claim Refresh Helper

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
  'dashboard.read': ['user', 'admin'],       // Dashboard access
} as const;

export const PublicCaps = new Set<Capability>([
  'util.firstUserCheck',
  'util.emailServiceStatus',
  'user.bootstrap', // Bootstrap capability available to all
]);
```

### 4.1.1 Database Schema with Enum Validation

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

### 4.3 Guard Wrapper

All Convex queries/mutations/actions are exported via `guarded.*`. The helper enforces capability-based access control before executing handlers.

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
  if (PublicCaps.has(cap)) return 'public';

  // Get authenticated user
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new Error(`Authentication required for ${cap}`);

  // Get role from database
  const profile = await ctx.db.query('userProfiles').first();
  const role = profile?.role || 'user';

  // Check capability permissions
  const allowedRoles = Caps[cap] ?? [];
  if (!allowedRoles.some(allowedRole => allowedRole === role)) {
    throw new Error(`Insufficient permissions for ${cap}`);
  }

  return role;
}
```

### 4.4 Client-Side RBAC Enforcement

**Conditional Role Fetching:**

```tsx
// Navigation components use lightweight auth
const authState = useAuthState(); // No DB calls
const { isAdmin } = useAuth({ fetchRole: authState.isAuthenticated });

// Capability-based UI components
<Allowed cap="user.write">
  <AdminButton />
</Allowed>
```

**Performance Optimization:**

- **Public pages:** Zero DB hits
- **Auth pages:** Zero DB hits
- **Dashboard:** 1 DB hit per session (cached)
- **Navigation:** Zero DB hits (uses cached auth state)

### 4.5 Sample Convex Functions

**Admin Operations:**

```ts
// convex/admin.ts
export const getAllUsers = guarded.query(
  'route:/app/admin.users',
  { page: v.number(), pageSize: v.number(), /* ... */ },
  async (ctx, args, _role) => {
    // Role already validated by guard - proceed with admin logic
    const users = await fetchUsers(ctx, args);
    return users;
  }
);

export const updateBetterAuthUser = guarded.mutation(
  'user.write',
  { userId: v.string(), name: v.string(), /* ... */ },
  async (ctx, args, _role) => {
    // Admin-only operation
    await updateUser(ctx, args);
  }
);
```

**Bootstrap Operations:**

```ts
// convex/users.ts
export const setUserRole = guarded.mutation(
  'user.bootstrap', // Public capability with logic restrictions
  { userId: v.string(), role: v.string(), allowBootstrap: v.optional(v.boolean()) },
  async (ctx, args, role) => {
    // Bootstrap logic enforced in handler
    if (!args.allowBootstrap && role !== 'admin') {
      throw new Error('Admin privileges required');
    }
    // ... bootstrap validation and role setting
  }
);
```

### 4.6 Client Capability Checks

Use the `Allowed` component for capability-based UI rendering. It uses proper role checking with conditional database queries.

```tsx
// src/lib/Allowed.tsx
export function Allowed({ cap, children }: AllowedProps) {
  const authState = useAuthState();

  // For public capabilities, allow without authentication
  if (PublicCaps.has(cap)) {
    return <>{children}</>;
  }

  // For protected capabilities, check role when authenticated
  const { isAdmin } = useAuth({ fetchRole: authState.isAuthenticated });
  const allowedRoles = Caps[cap] ?? [];
  const userRole = isAdmin ? 'admin' : 'user';

  if (!allowedRoles.some(allowedRole => allowedRole === userRole)) {
    return null;
  }

  return <>{children}</>;
}

// Usage in components
<Allowed cap="user.write">
  <AdminButton />
</Allowed>
```

### 4.7 Route Guards

Server-side route guards use capability-based validation before page loads.

```ts
// src/features/auth/server/route-guards.ts
export async function routeCapabilityGuard(
  cap: Capability,
  location: ParsedLocation
): Promise<RouterAuthContext> {
  try {
    const { user } = await requireAuth(); // Hits Convex DB

    // Check if user's role grants access to the capability
    const allowedRoles = Caps[cap] ?? [];
    if (!allowedRoles.some(allowedRole => allowedRole === user.role)) {
      throw redirect({ to: '/login', search: { redirect: location.href } });
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

## Adding New Capabilities

### Step-by-Step Guide

**1. Define the Capability Type**
Add to `convex/authz/policy.map.ts`:

```ts
export type Capability =
  | 'route:/app'
  | 'route:/app/admin'
  | 'route:/app/admin.users'
  | 'user.write'
  | 'profile.read'
  | 'profile.write'
  | 'util.firstUserCheck'
  | 'util.emailServiceStatus'
  | 'dashboard.read'
  | 'posts.create'     // New capability
  | 'posts.delete';    // New capability
```

**2. Add to Capability Map**

```ts
export const Caps = {
  // ... existing capabilities
  'posts.create': ['user', 'admin'],
  'posts.delete': ['admin'],
} as const;
```

**3. Add Public Capabilities (if needed)**

```ts
export const PublicCaps = new Set<Capability>([
  'util.firstUserCheck',
  'util.emailServiceStatus',
  'user.bootstrap',
  // Add new public capabilities here
]);
```

**4. Use in Convex Functions**

```ts
// convex/posts.ts
export const createPost = guarded.mutation(
  'posts.create',
  { title: v.string(), content: v.string() },
  async (ctx, args, role) => {
    // Implementation - role is guaranteed to have posts.create capability
  }
);

export const deletePost = guarded.mutation(
  'posts.delete',
  { postId: v.string() },
  async (ctx, args, role) => {
    // Implementation - only admins can reach this
  }
);
```

**5. Protect Routes (if needed)**
```ts
// src/routes/app/posts/create.tsx
export const Route = createFileRoute('/app/posts/create')({
  beforeLoad: ({ location }) => routeCapabilityGuard('posts.create', location),
});
```

**6. Add UI Components**
```tsx
<Allowed cap="posts.create">
  <CreatePostButton />
</Allowed>

<Allowed cap="posts.delete">
  <DeletePostButton />
</Allowed>
```

## Performance Characteristics

| Scenario | DB Hits | Implementation |
|----------|---------|----------------|
| Public pages | 0 | `useAuthState()` only |
| Auth pages | 0 | Session validation only |
| Dashboard load | 1 | Cached role fetch |
| Navigation | 0 | Convex caching |
| Role changes | Auto-invalidation | Real-time updates |

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
  await ctx.runMutation(api.posts.createPost, args);
} catch (error) {
  if (error.message.includes('Insufficient permissions')) {
    // Handle permission denied gracefully
    throw new Error('You do not have permission to create posts');
  }
  throw error;
}
```

### Testing
```ts
// Test capability enforcement
describe('createPost', () => {
  it('requires posts.create capability', async () => {
    // Test with different user roles
  });

  it('allows users and admins to create posts', async () => {
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

## 5. RBAC Performance & Security

### 5.1 Database Hit Optimization

The RBAC system is designed to minimize database queries while maintaining security and real-time updates:

- **Public/Auth pages:** 0 DB hits (uses lightweight auth state)
- **Dashboard initial load:** 1 DB hit for role data (Convex cached)
- **Subsequent navigation:** 0 DB hits (Convex caching preserves role data)
- **Role changes:** Automatic cache invalidation via Convex subscriptions

### 5.2 Security Layers

1. **Route Guards** (Server) - Pre-load validation
2. **Convex Guards** (Server) - Database operation validation
3. **UI Components** (Client) - Conditional rendering
4. **Bootstrap Logic** (Server) - Special case handling

### 5.3 Real-time Role Updates

- Convex subscriptions automatically invalidate cached role data
- UI updates immediately when roles change
- No manual cache invalidation required

---

## 6. Data Access & Real-Time Updates

### 6.1 Dashboard Example

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

### 6.2 Convex Client Setup

```ts
// src/lib/convexClient.ts
const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.VITE_CONVEX_SITE_URL;
export const convexClient = new ConvexReactClient(convexUrl, { expectAuth: true });
```

Servers call Convex through `setupFetchClient` for authenticated operations (`src/features/auth/server/user-management.ts`).

---

## 7. Error Handling & UX

- Custom error boundaries (`src/components/RouteErrorBoundaries.tsx`) ignore redirect responses to avoid logging noise.
- Skeleton components at route level for perceived performance (`AppLayoutSkeleton`, `AuthSkeleton`, etc.).
- Navigation components use optimized auth hooks to minimize DB hits while showing admin features appropriately.

---

## 8. Environment & Secrets

- `.env.example` enumerates required keys.
- `README.md` documents the `ROOT_ADMINS` override to guarantee at least one admin.
- Server-only modules (`*.server.ts`) guard against leaking secrets client-side.

---

## 9. Tooling & Quality Gates

- `pnpm fix` runs Biome formatting and linting.
- `pnpm typecheck` ensures type safety.
- `node tools/eslint-guarded-convex-exports.js` confirms all Convex exports go through the guard helper.

---

## 10. RBAC Architecture Summary

### Performance Characteristics

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
- `Allowed` - Client-side capability-based rendering
- Route guards - Pre-load security validation

### Key Benefits

- ✅ **Performance optimized** - minimal database overhead through conditional fetching
- ✅ **Security enhanced** - consistent capability-based authorization across all layers
- ✅ **Maintainable** - single source of truth for permissions in capability map
- ✅ **Real-time** - automatic cache invalidation when roles change

---

This overview should help reviewers trace decisions from routing all the way to server functions and RBAC enforcement. Update it whenever major architectural choices change.
