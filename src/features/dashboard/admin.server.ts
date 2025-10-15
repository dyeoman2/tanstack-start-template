import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '~/db/schema';
import { requireAdmin } from '~/features/auth/server/auth-guards';
import { getErrorMessage, ValidationError } from '~/lib/error-handler';
import { getDb } from '~/lib/server/db-config.server';
import { throwServerError } from '~/lib/server/error-utils.server';

// Zod schemas for validation
const truncateDataSchema = z.object({
  confirmText: z.literal('TRUNCATE_ALL_DATA'),
});

const deleteUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  confirmation: z.string().min(1, 'Confirmation text is required'),
});

// Server function to truncate data - runs ONLY on server
export const truncateDataServerFn = createServerFn({ method: 'POST' })
  .inputValidator(truncateDataSchema)
  .handler(async ({ data: _data }) => {
    // Only admins can truncate data
    const { user } = await requireAdmin();

    try {
      // Get request info for audit logging
      if (!import.meta.env.SSR) {
        throwServerError('truncateDataServerFn is only available on the server', 500);
      }
      const request = getRequest();

      // Tables to truncate
      // PRESERVE: user, session, auth_account, verification, audit_log (system-level)
      const tablesToTruncate = ['TABLES_TO_TRUNCATE'];

      // Track successfully truncated tables for error reporting
      const truncatedTables: string[] = [];
      const failedTables: string[] = [];

      // Truncate each table individually (no transaction support in Neon HTTP)
      for (const tableName of tablesToTruncate) {
        try {
          await getDb().execute(sql`DELETE FROM ${sql.identifier(tableName)}`);
          truncatedTables.push(tableName);
        } catch (tableError) {
          failedTables.push(tableName);
          console.error(`Failed to truncate table: ${tableName}`, tableError);
        }
      }

      // Log the truncation in audit log
      await getDb()
        .insert(schema.auditLog)
        .values({
          id: crypto.randomUUID(),
          userId: user.id,
          action: 'TRUNCATE_ALL_DATA',
          entityType: 'SYSTEM',
          entityId: null,
          metadata: JSON.stringify({
            truncatedTables: truncatedTables.length,
            failedTables: failedTables.length,
            tables: truncatedTables,
            failed: failedTables,
            note: 'Neon HTTP driver used - no transaction support',
          }),
          createdAt: new Date(),
          ipAddress: request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || null,
          userAgent: request.headers.get('User-Agent') || null,
        });

      // If any tables failed to truncate, include this in the response
      const hasPartialFailure = failedTables.length > 0;

      // Prepare response based on success/failure
      const totalTables = tablesToTruncate.length;
      const successCount = truncatedTables.length;
      const failureCount = failedTables.length;

      let message: string;
      if (hasPartialFailure) {
        message = `Partial truncation completed. ${successCount}/${totalTables} tables truncated successfully. Failed tables: ${failedTables.join(', ')}. User accounts and authentication data preserved.`;
      } else {
        message = `All financial data has been truncated successfully. User accounts and authentication data preserved.`;
      }

      return {
        success: !hasPartialFailure,
        message,
        truncatedTables: successCount,
        failedTables: failureCount,
        totalTables,
        failedTableNames: failedTables,
        invalidateAllCaches: true, // Flag to tell client to invalidate all React Query caches
      };
    } catch (error) {
      console.error('Failed to truncate data');
      throw new ValidationError('Failed to truncate data', getErrorMessage(error));
    }
  });

const updateUserProfileSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  email: z.string().email('Invalid email format').min(1, 'Email is required'),
  role: z.enum(['user', 'admin']),
});

// Get all users (admin only)
export const getAllUsersServerFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(10),
      sortBy: z.enum(['name', 'email', 'role', 'emailVerified', 'createdAt']).default('role'),
      sortOrder: z.enum(['asc', 'desc']).default('asc'),
      secondarySortBy: z
        .enum(['name', 'email', 'role', 'emailVerified', 'createdAt'])
        .default('name'),
      secondarySortOrder: z.enum(['asc', 'desc']).default('asc'),
      search: z.string().trim().max(100).optional(),
      role: z.enum(['all', 'user', 'admin']).default('all'),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const db = getDb();
    const { page, pageSize, sortBy, sortOrder, secondarySortBy, secondarySortOrder, role } = data;
    const searchTerm = data.search?.trim();

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;

    // Build the order by clauses
    const getOrderByColumn = (column: string) => {
      switch (column) {
        case 'name':
          return schema.user.name;
        case 'email':
          return schema.user.email;
        case 'role':
          return schema.user.role;
        case 'emailVerified':
          return schema.user.emailVerified;
        case 'createdAt':
          return schema.user.createdAt;
        default:
          return schema.user.createdAt;
      }
    };

    const primaryOrderBy =
      sortOrder === 'desc' ? desc(getOrderByColumn(sortBy)) : getOrderByColumn(sortBy);
    const secondaryOrderBy =
      secondarySortOrder === 'desc'
        ? desc(getOrderByColumn(secondarySortBy))
        : getOrderByColumn(secondarySortBy);

    const orderByClause = [primaryOrderBy, secondaryOrderBy];

    const sanitizedSearch = searchTerm?.replace(/[%_\\]/g, (char) => `\\${char}`);
    const searchPattern = sanitizedSearch ? `%${sanitizedSearch}%` : undefined;
    const searchCondition = searchPattern
      ? or(ilike(schema.user.name, searchPattern), ilike(schema.user.email, searchPattern))
      : undefined;
    const roleCondition = role === 'all' ? undefined : eq(schema.user.role, role);
    const combinedCondition =
      searchCondition && roleCondition
        ? and(searchCondition, roleCondition)
        : (searchCondition ?? roleCondition);

    // Get total count for pagination
    const baseCountQuery = db.select({ count: sql<number>`count(*)` }).from(schema.user);
    const countQuery = combinedCondition ? baseCountQuery.where(combinedCondition) : baseCountQuery;
    const [{ count }] = await countQuery;

    // Get paginated users
    const baseUsersQuery = db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        name: schema.user.name,
        role: schema.user.role,
        emailVerified: schema.user.emailVerified,
        createdAt: schema.user.createdAt,
        updatedAt: schema.user.updatedAt,
      })
      .from(schema.user);

    const filteredUsersQuery = combinedCondition
      ? baseUsersQuery.where(combinedCondition)
      : baseUsersQuery;

    const users = await filteredUsersQuery
      .orderBy(...orderByClause)
      .limit(pageSize)
      .offset(offset);

    return {
      users,
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
      },
    };
  });

export type GetAllUsersServerFn = Awaited<ReturnType<typeof getAllUsersServerFn>>;

// Update user profile (name and email) (admin only)
export const updateUserProfileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(updateUserProfileSchema)
  .handler(async ({ data }) => {
    const { userId, name, email, role } = data;

    await requireAdmin();

    // Verify user exists
    const existingUser = await getDb()
      .select({ id: schema.user.id, email: schema.user.email, role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (existingUser.length === 0) {
      throwServerError('User not found', 404);
    }

    // Check if email is already taken by another user
    if (email !== existingUser[0].email) {
      const emailCheck = await getDb()
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);

      if (emailCheck.length > 0) {
        throwServerError('Email address is already in use by another user', 400);
      }
    }

    // Update user profile
    await getDb()
      .update(schema.user)
      .set({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));

    return { success: true, message: 'User profile updated successfully' };
  });

// Get system statistics (admin only)
export const getSystemStatsServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin();

  // Get various counts
  const userCount = await getDb().select({ count: sql<number>`count(*)` }).from(schema.user);
  return {
    users: Number(userCount[0]?.count ?? 0),
  };
});

// Delete user and all associated data (admin only)
export const deleteUserServerFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteUserSchema)
  .handler(async ({ data }) => {
    const { userId, confirmation } = data;

    if (confirmation !== 'DELETE_USER_DATA') {
      throwServerError('Invalid confirmation', 400);
    }

    await requireAdmin();

    // Check if the user being deleted is an admin
    const userToDelete = await getDb()
      .select({ id: schema.user.id, email: schema.user.email, role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (userToDelete.length === 0) {
      throwServerError('User not found', 404);
    }

    // Prevent deletion of the only admin user
    if (userToDelete[0].role === 'admin') {
      const adminCount = await getDb()
        .select({ count: sql<number>`count(*)` })
        .from(schema.user)
        .where(eq(schema.user.role, 'admin'));

      if (Number(adminCount[0]?.count ?? 0) <= 1) {
        throwServerError('Cannot delete the only admin user. At least one admin must remain.', 400);
      }
    }

    // Delete user and all associated data
    // Cascade deletes will handle all related records:
    // - sessions, auth accounts, audit logs
    // - applications (via createdBy) -> application documents/agents/checklist items/reviews
    // - application checklist items and document reviews (via completedBy/reviewedBy)
    await getDb().delete(schema.user).where(eq(schema.user.id, userId));

    return {
      success: true,
      message: `User ${userToDelete[0].email} and all associated data deleted successfully`,
    };
  });
