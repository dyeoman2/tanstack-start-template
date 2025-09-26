# TanStack Start Development Guidelines

## Philosophy: Developer Experience First

TanStack Start isn't just a framework—it's a philosophy. We believe that developers should spend their time solving business problems, not fighting their tools. Every decision in TanStack Start prioritizes:

- **Type Safety**: Full-stack TypeScript with zero compromises
- **Performance**: Aggressive optimization by default
- **Developer Experience**: Intuitive APIs that guide you toward best practices
- **Progressive Enhancement**: Server-first architecture that degrades gracefully

## Project Architecture & TanStack Integration

### Core Stack Overview
This is a TanStack Start Starter application built to give you a head start on your next project.

- **TanStack Start**: Full-stack framework with server functions and file-based routing
- **TanStack Router**: Type-safe routing with aggressive preloading
- **TanStack Query**: Intelligent caching and synchronization
- **React + Tailwind**: Modern UI with utility-first styling
- **PostgreSQL + Drizzle**: Type-safe database operations
- **Better Auth**: Secure authentication with custom role management

### File Structure Philosophy

```
src/
├── routes/           # File-based routing (TanStack Router)
├── components/       # Reusable UI components
├── features/         # Feature-based organization
│   ├── auth/         # Authentication logic
│   ├── dashboard/    # Dashboard feature
│   └── admin/        # Admin functionality
├── lib/              # Shared utilities and business logic
│   ├── server-functions.ts # Server function definitions
│   └── utils.ts           # Shared utilities
├── db/               # Database schema and migrations
└── types/            # TypeScript type definitions
```

### Key Architectural Principles

1. **Server Functions as API**: Every server function is a type-safe API endpoint
2. **Route-based Code Splitting**: Automatic code splitting at route boundaries
3. **Progressive Data Loading**: Server → Client hydration with React Query
4. **Type Safety Everywhere**: Database → Server → Client chain

## Development Workflow

### Essential Commands
```bash
# Development
pnpm dev              # Start development server with HMR
pnpm build           # Production build with type checking
pnpm start           # Run production server from .output/
pnpm typecheck       # Standalone type checking

# Database
pnpm db:generate     # Generate Drizzle migrations
pnpm db:migrate      # Apply migrations locally
pnpm db:migrate:prod # Apply to production
pnpm db:studio       # Open Drizzle Studio

# Code Quality
pnpm lint           # Lint with Biome
pnpm format         # Format code with Biome
pnpm seed           # Seed development data
```

### Development Philosophy
- **Fast Feedback Loops**: HMR, type checking, and testing should be instant
- **Type-First Development**: Write types before implementation
- **Test-Driven**: Server functions should be tested before UI integration
- **Progressive Enhancement**: App works without JavaScript, enhanced with it

## Code Quality Standards

### TypeScript Excellence
- **Strict Mode Always**: No `any`, no exceptions
- **Branded Types**: Use branded types for domain IDs (`type UserId = string & { __brand: 'UserId' }`)
- **Utility Types**: Leverage `Awaited<ReturnType<typeof fn>>` for server function returns
- **Interface vs Type**: Use `interface` for objects, `type` for unions/primitives

### Naming Conventions
```
Components:     PascalCase.tsx          (UserProfile.tsx)
Hooks:          camelCase.ts            (useAuth.ts)
Server Fns:     camelCaseServerFn.ts    (getUserServerFn)
Routes:         kebab-case.tsx          (user-profile.tsx)
Utils:          camelCase.ts            (formatCurrency.ts)
Types:          PascalCase.ts           (UserRole.ts)
Database:       camelCase.sql           (create_user.sql)
```

### Import Organization
```typescript
// 1. React imports
import { useState, useEffect } from 'react'

// 2. Third-party libraries (alphabetical)
import { createServerFn } from '@tanstack/start'
import { useQuery } from '@tanstack/react-query'

// 3. Internal imports (by layer: routes → components → lib → types)
import { api } from '~/lib/api'
import { User } from '~/types/user'
```

## UI/UX Excellence

Use shadcn/ui components with Tailwind CSS. Prefer composition over custom CSS. Ensure semantic HTML, keyboard navigation, and proper loading states.

## Git Workflow

Commits: Imperative mood, concise subjects (<72 chars), detailed bodies. PRs: Clear titles, comprehensive descriptions, link issues, ensure tests pass.

## Security & Configuration

Copy `.env.example` to `.env.local`. Required env vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.

**Security**: Server-side secrets only, validate all inputs, rate limiting, HTTPS in production, Better Auth sessions.

## TanStack Start Mastery Guide

TanStack Start eliminates full-stack complexity with complete type safety. Think "Next.js, but actually good" - type-safe server functions, intelligent routing, and developer-first experience.

### 🚀 Router Architecture

**File-Based Routing**: Routes are files, automatic code splitting. Use `createFileRoute()` with loaders for server data.

```typescript
export const Route = createFileRoute('/dashboard')({
  loader: async () => await getDashboardDataServerFn(),
  component: DashboardPage,
})
```

**Aggressive Preloading**: `defaultPreload: 'intent'`, 30s stale time, 5min GC time.

**Type-Safe Search Params**: Use Zod schemas with `validateSearch`.

### 📊 Data Fetching

**Server-Client Hydration**: Route loaders fetch server data, pass as `initialData` to React Query.

```typescript
export const Route = createFileRoute('/dashboard')({
  loader: async () => await getDashboardDataServerFn(),
  component: DashboardPage,
})

function DashboardPage() {
  const { data } = useDashboardQuery({
    initialData: Route.useLoaderData(),
  })
  return <Dashboard data={data} />
}
```

**Query Keys**: Organized constants, targeted invalidation. **Stale Times**: 5min for stable data, 30s for volatile data.

### 🔧 Server Functions

**Single Responsibility**: Each server function does ONE thing. No mixing data ops, external APIs, auth, email.

```typescript
// ✅ GOOD: One purpose
export const getUserProfileServerFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data: { userId } }) => {
    const db = getDb()
    return await db.query.users.findFirst({
      where: eq(users.id, userId),
      select: { id: true, name: true, email: true }
    })
  })
```

**Static Imports**: Never use dynamic imports in server functions - they kill performance.

**Auth Guards**: Use middleware for authentication, `requireAuth()` and `requireAdmin()` helpers.

### ⚛️ Component Architecture Excellence

#### Feature-Based Organization
```
src/features/
├── dashboard/
│   ├── components/
│   │   ├── dashboard-header.tsx
│   │   └── metric-card.tsx
│   ├── hooks/
│   │   ├── use-dashboard-data.ts
│   │   └── use-metrics.ts
│   ├── server.ts          # Server functions for dashboard
│   └── index.ts           # Main dashboard component
```

#### Custom Hook Patterns
```typescript
// ✅ GOOD: Custom hooks encapsulate complex logic
function useUserManagement(userId: string) {
  const { data: user } = useUserQuery(userId)
  const { data: permissions } = usePermissionsQuery()
  const updateUserMutation = useUpdateUserMutation()

  const { canEdit, availableRoles } = useMemo(() => {
    if (!user || !permissions) return {}

    return {
      canEdit: permissions.includes('admin') || permissions.includes('user.edit'),
      availableRoles: permissions.includes('admin') ? ['admin', 'user'] : ['user']
    }
  }, [user, permissions])

  return {
    user,
    canEdit,
    availableRoles,
    updateUser: (updates: Partial<User>) => updateUserMutation.mutate({ userId, ...updates }),
    isUpdating: updateUserMutation.isPending,
  }
}

// Usage in component
function UserProfile({ userId }: { userId: string }) {
  const { canEdit, updateUser, isUpdating } = useUserManagement(userId)

  return (
    <Button
      onClick={() => updateUser({ name: 'New Name' })}
      disabled={!canEdit || isUpdating}
    >
      {isUpdating ? 'Updating...' : 'Update User'}
    </Button>
  )
}
```

#### Error Boundaries & Logging
```typescript
// src/components/error-boundary.tsx
class FeatureErrorBoundary extends Component {
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(error, {
      component: 'FeatureErrorBoundary',
      feature: this.props.feature,
      errorInfo,
      userId: this.props.userId,
    })
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback feature={this.props.feature} />
    }

    return this.props.children
  }
}

// Usage
<FeatureErrorBoundary feature="dashboard" userId={userId}>
  <Dashboard />
</FeatureErrorBoundary>
```

#### Auth Hook Optimization
```typescript
export function useAuth() {
  const { data: session, isPending, error } = useSession()

  const user = useMemo(() => {
    return session?.user ? {
      ...session.user,
      role: (session.user as { role?: UserRole }).role || 'user',
    } : null
  }, [session?.user])

  const authState = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isPending,
    error,
  }), [user, isPending, error])

  return authState
}

### 🎨 Performance Optimization

**Bundle Splitting**: Automatic route-based splitting, lazy load heavy components.

**React Query**: Targeted invalidation, optimistic updates, proper stale times.

### 🔒 Security Architecture

**Input Validation**: Comprehensive Zod schemas on all server functions. Never trust client data.

## 🚨 Critical Antipatterns to Avoid

As the creator of TanStack Start, I've seen every possible way to misuse this framework. Here are the most critical antipatterns that will destroy your performance and developer experience:

### ❌ Performance Killers

#### 1. Dynamic Imports in Server Functions
```typescript
// ❌ DEADLY: Kills performance with async overhead
export const someServerFn = createServerFn().handler(async () => {
  const { getData } = await import('~/lib/db-operations'); // BLOCKING!
  return getData();
});

// ✅ LIGHTNING FAST: Static imports
import { getData } from '~/lib/db-operations';
export const someServerFn = createServerFn().handler(async () => {
  return getData(); // Synchronous execution
});
```

#### 2. Broad Query Invalidation
```typescript
// ❌ SLOWS DOWN THE ENTIRE APP
queryClient.invalidateQueries(); // Clears ALL cached data!

// ✅ TARGETED: Only invalidate what changed
queryClient.invalidateQueries({
  queryKey: queryKeys.user(userId),
  exact: true,
});
```

#### 3. Waterfall Data Fetching
```typescript
// ❌ BAD: Route loader then component fetches more
export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    const basicData = await fetchBasicData();
    return basicData;
  },
});

function Dashboard() {
  const { data: basicData } = Route.useLoaderData();
  const { data: extraData } = useExtraDataQuery(); // WATERFALL!
  // ...
}

// ✅ GOOD: Single loader with all data
export const Route = createFileRoute('/dashboard')({
  loader: async () => {
    const [basicData, extraData] = await Promise.allSettled([
      fetchBasicData(),
      fetchExtraData(),
    ]);
    return { basicData, extraData };
  },
});
```

### ❌ Architecture Violations

#### 4. Server Functions with Multiple Responsibilities
```typescript
// ❌ VIOLATES SINGLE RESPONSIBILITY
export const createUserAndSendEmailServerFn = createServerFn()
  .handler(async ({ data }) => {
    // 1. Create user in database
    // 2. Send welcome email
    // 3. Update analytics
    // 4. Call external API
  });

// ✅ ONE FUNCTION, ONE PURPOSE
export const createUserServerFn = createServerFn()...
export const sendWelcomeEmailServerFn = createServerFn()...
export const trackUserCreationServerFn = createServerFn()...
```

#### 5. Client-Side Navigation Bypassing Router
```typescript
// ❌ BREAKS HYDRATION & ROUTER STATE
const handleRedirect = () => {
  window.location.href = '/new-page'; // NO!
};

// ✅ USES TANSTACK ROUTER
import { useRouter } from '@tanstack/react-router';
const handleRedirect = () => {
  const router = useRouter();
  router.navigate({ to: '/new-page' });
};
```

#### 6. Auth Logic in Components
```typescript
// ❌ SCATTERS AUTH LOGIC EVERYWHERE
function MyComponent() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <LoginPrompt />;
  return <ProtectedContent />;
}

// ✅ ROUTE-LEVEL AUTH GUARDS
export const Route = createFileRoute('/protected')({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: MyComponent, // Pure UI component
});
```

### ✅ When Breaking Rules is Acceptable

**Dynamic Imports ARE OK for:**
- Heavy client libraries: `await import('exceljs')`
- Conditional admin features: `await import('./admin-panel')`
- Large utility libraries that are rarely used

**Multiple Server Function Calls ARE OK for:**
- Orchestration functions that compose other server functions
- User-facing operations that require multiple steps
- Complex business workflows

### 📋 Implementation Checklist

Before committing code, ask yourself:

**Server Functions:**
- [ ] Does this function do ONE thing well?
- [ ] Are all imports static (not dynamic)?
- [ ] Is validation comprehensive but not excessive?
- [ ] Are database queries optimized with select()?
- [ ] Does it handle errors gracefully?

**Components:**
- [ ] Is complex logic extracted to custom hooks?
- [ ] Are expensive computations memoized?
- [ ] Is the component wrapped in error boundaries?
- [ ] Does it use proper loading states?

**Data Fetching:**
- [ ] Are query keys properly organized?
- [ ] Is stale time appropriate for the data?
- [ ] Does invalidation target specific queries?
- [ ] Are optimistic updates implemented where beneficial?

**Performance:**
- [ ] Is bundle splitting implemented for heavy components?
- [ ] Are images lazy loaded?
- [ ] Is code splitting working at route boundaries?
- [ ] Are there any console errors or warnings?