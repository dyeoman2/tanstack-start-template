/**
 * Advanced Query Key Factory with Type-Safe Dynamic Keys
 *
 * Provides sophisticated query key management with:
 * - Factory functions for dynamic keys
 * - Hierarchical key organization
 * - Type-safe parameter handling
 * - Consistent naming patterns
 * - Tree-shakable constants for better bundle optimization
 *
 * @example
 * ```typescript
 * // Use constants for better tree-shaking
 * queryClient.invalidateQueries({ queryKey: ADMIN_KEYS.USERS_ALL })
 *
 * // Use factory functions for dynamic keys
 * queryClient.invalidateQueries({
 *   queryKey: queryKeys.admin.users.detail(userId)
 * })
 * ```
 */

// Base key creators for type safety
const createKey = <T extends readonly unknown[]>(...parts: T) => parts;
const createDynamicKey = <T extends readonly unknown[], P>(base: T, param: P) =>
  [...base, param] as const;

// Query key constants for better tree-shaking
export const ADMIN_KEYS = {
  ALL: ['admin'] as const,
  LISTS: ['admin', 'list'] as const,
  DETAILS: ['admin', 'detail'] as const,
  USERS_ALL: ['admin', 'users'] as const,
  STATS: ['admin', 'stats'] as const,
  SYSTEM_METRICS: ['admin', 'system', 'metrics'] as const,
  AUDIT: ['admin', 'audit'] as const,
} as const;

export const SYSTEM_KEYS = {
  ENVIRONMENT: ['system', 'environment'] as const,
  EMAIL_SERVICE: ['system', 'email-service'] as const,
  CONFIG: ['system', 'config'] as const,
  HEALTH: ['system', 'health'] as const,
} as const;

// Domain-specific key factories
const queryKeys = {
  // Dashboard domain - simplified for basic starter
  dashboard: {
    // Base keys
    all: () => createKey('dashboard'),
    stats: () => createKey('dashboard', 'stats'),
    activity: () => createKey('dashboard', 'activity'),
  },

  // Admin domain
  admin: {
    // Base keys
    all: () => createKey('admin'),
    lists: () => createKey('admin', 'list'),
    details: () => createKey('admin', 'detail'),

    // User management - simplified for starter
    users: {
      all: () => createKey('admin', 'users'),
      detail: (userId: string) => createDynamicKey(queryKeys.admin.users.all(), userId),
    },

    // System stats
    stats: () => createKey('admin', 'stats'),
    systemMetrics: () => createKey('admin', 'system', 'metrics'),
    auditLogs: (filters?: {
      action?: string;
      userId?: string;
      dateRange?: { from: Date; to: Date };
    }) =>
      filters
        ? createDynamicKey(createKey('admin', 'audit'), filters)
        : createKey('admin', 'audit'),
  },

  // Authentication domain
  auth: {
    session: () => createKey('auth', 'session'),
    user: () => createKey('auth', 'user'),
    profile: (userId: string) => createDynamicKey(queryKeys.auth.user(), userId),
    permissions: (userId: string) =>
      createDynamicKey(queryKeys.auth.profile(userId), 'permissions'),
  },

  // System domain
  system: {
    environment: () => createKey('system', 'environment'),
    emailService: () => createKey('system', 'email-service'),
    config: () => createKey('system', 'config'),
    health: () => createKey('system', 'health'),
  },
} as const;

// Type exports for advanced usage
export type AuditLogFilters = Parameters<typeof queryKeys.admin.auditLogs>[0];

/**
 * Centralized Query Invalidation Helpers
 *
 * Provides type-safe invalidation methods for React Query cache management.
 * These helpers ensure consistent invalidation patterns across the application.
 */
/**
 * Advanced Query Invalidation Helpers with Pattern Matching
 *
 * Provides sophisticated invalidation strategies with:
 * - Pattern-based invalidation for related queries
 * - Selective invalidation to minimize refetches
 * - Type-safe invalidation methods
 * - Composite operations for common workflows
 */
export const queryInvalidators = {
  // Dashboard domain invalidation - simplified for starter
  dashboard: {
    // Invalidate all dashboard data
    all: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() });
    },

    // Invalidate specific dashboard sections
    stats: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats(), exact: true });
    },
    activity: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.activity(), exact: true });
    },
  },

  // Admin domain invalidation
  admin: {
    all: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() });
    },

    // User management invalidation - simplified for starter
    users: {
      all: (queryClient: import('@tanstack/react-query').QueryClient) => {
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all() });
      },
      detail: (queryClient: import('@tanstack/react-query').QueryClient, userId: string) => {
        // Invalidate all user-related queries for this user
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.users.detail(userId),
          exact: false,
        });
      },
    },

    // System stats invalidation
    stats: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.stats(), exact: true });
    },

    systemMetrics: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.systemMetrics(), exact: true });
    },

    auditLogs: (
      queryClient: import('@tanstack/react-query').QueryClient,
      filters?: AuditLogFilters,
    ) => {
      if (filters) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.auditLogs(filters),
          exact: true,
        });
      } else {
        queryClient.invalidateQueries({ queryKey: createKey('admin', 'audit') });
      }
    },
  },

  // Authentication invalidation
  auth: {
    session: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session(), exact: true });
    },
    user: (queryClient: import('@tanstack/react-query').QueryClient, userId?: string) => {
      if (userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.profile(userId), exact: false });
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.user() });
      }
    },
    permissions: (queryClient: import('@tanstack/react-query').QueryClient, userId: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.permissions(userId), exact: true });
    },
  },

  // System invalidation
  system: {
    environment: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.system.environment(), exact: true });
    },
    emailService: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.system.emailService(), exact: true });
    },
    config: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.system.config(), exact: true });
    },
    health: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.system.health(), exact: true });
    },
  },

  // Composite operations for common workflows
  composites: {
    // After admin user operations (create/update/delete user)
    afterAdminUserOperation: (
      queryClient: import('@tanstack/react-query').QueryClient,
      userId?: string,
    ) => {
      queryInvalidators.admin.users.all(queryClient);
      if (userId) {
        queryInvalidators.admin.users.detail(queryClient, userId);
        queryInvalidators.auth.user(queryClient, userId);
      }
    },

    // After dashboard activity (new signups, purchases, etc.)
    afterDashboardActivity: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryInvalidators.dashboard.stats(queryClient);
      queryInvalidators.dashboard.activity(queryClient);
    },

    // Complete data refresh (use sparingly - expensive)
    completeRefresh: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries();
    },

    // User logout - clear all user-specific data
    userLogout: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.clear(); // Clear entire cache on logout
    },
  },
} as const;
