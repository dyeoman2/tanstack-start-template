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
// Domain-specific key factories
export const queryKeys = {
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
      list: (params?: {
        page?: number;
        pageSize?: number;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        search?: string;
        role?: 'all' | 'user' | 'admin';
      }) => createDynamicKey(createKey('admin', 'users', 'list'), params ?? {}),
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
    currentProfile: () => createKey('auth', 'profile', 'current'),
    permissions: (userId: string) =>
      createDynamicKey(queryKeys.auth.profile(userId), 'permissions'),
  },

  // Applications domain
  applications: {
    all: () => createKey('applications'),
    list: (params?: {
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }) => createDynamicKey(createKey('applications', 'list'), params ?? {}),
    detail: (id: string) => createDynamicKey(queryKeys.applications.all(), id),
    agents: (applicationId: string) => createKey('applications', applicationId, 'agents'),
    indemnification: (applicationId: string) =>
      createKey('applications', applicationId, 'indemnification'),
  },

  // Application documents invalidation
  applicationDocuments: {
    all: () => createKey('application-documents'),
    list: (filters?: { applicationId?: string }) =>
      createDynamicKey(queryKeys.applicationDocuments.all(), filters ?? {}),
    detail: (id: string) => createDynamicKey(queryKeys.applicationDocuments.all(), id),
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
    profile: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.currentProfile(), exact: true });
    },
    permissions: (queryClient: import('@tanstack/react-query').QueryClient, userId: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.permissions(userId), exact: true });
    },
  },

  // Applications invalidation
  applications: {
    all: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.applications.all() });
    },
    list: (queryClient: import('@tanstack/react-query').QueryClient) => {
      // Invalidate all applications list queries regardless of pagination/sort parameters
      queryClient.invalidateQueries({
        queryKey: queryKeys.applications.list(),
        exact: false,
      });
    },
    detail: (queryClient: import('@tanstack/react-query').QueryClient, id: string) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.applications.detail(id), exact: true });
    },
    indemnification: (
      queryClient: import('@tanstack/react-query').QueryClient,
      applicationId: string,
    ) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.applications.indemnification(applicationId),
        exact: true,
      });
    },
  },

  applicationDocuments: {
    all: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.applicationDocuments.all() });
    },
    list: (
      queryClient: import('@tanstack/react-query').QueryClient,
      filters?: { applicationId?: string },
    ) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.applicationDocuments.list(filters ?? {}),
        exact: true,
      });
    },
    detail: (queryClient: import('@tanstack/react-query').QueryClient, id: string) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.applicationDocuments.detail(id),
        exact: true,
      });
    },
  },

  // Checklist invalidation - hierarchical and consistent with query keys
  checklist: {
    // Invalidate all checklist queries
    all: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryClient.invalidateQueries({ queryKey: ['checklist'] });
    },

    // Invalidate all checklist queries for a specific application
    application: (
      queryClient: import('@tanstack/react-query').QueryClient,
      applicationId: string,
    ) => {
      queryClient.invalidateQueries({
        queryKey: ['checklist', applicationId],
        exact: false, // Invalidate all area and showAll variations for this application
      });
    },

    // Invalidate all checklist queries for a specific application and area
    area: (
      queryClient: import('@tanstack/react-query').QueryClient,
      applicationId: string,
      area: string,
    ) => {
      queryClient.invalidateQueries({
        queryKey: ['checklist', applicationId, area],
        exact: false, // Invalidate all showAll variations for this area
      });
    },

    // Invalidate a specific checklist query (exact match)
    detail: (
      queryClient: import('@tanstack/react-query').QueryClient,
      applicationId: string,
      area: string,
      showAll: boolean = false,
    ) => {
      queryClient.invalidateQueries({
        queryKey: ['checklist', applicationId, area, showAll],
        exact: true,
      });
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

    // After application creation
    afterApplicationCreation: (queryClient: import('@tanstack/react-query').QueryClient) => {
      queryInvalidators.applications.list(queryClient);
    },

    // After application update (including automatic permit imports)
    afterApplicationUpdate: (
      queryClient: import('@tanstack/react-query').QueryClient,
      applicationId: string,
    ) => {
      queryInvalidators.applications.list(queryClient);
      queryInvalidators.applications.detail(queryClient, applicationId);
      // Invalidate checklist and documents for the updated application
      queryInvalidators.checklist.area(queryClient, applicationId, 'zoning_prep');
      queryInvalidators.checklist.area(queryClient, applicationId, 'post_clearance');
      queryInvalidators.applicationDocuments.list(queryClient, { applicationId });
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
