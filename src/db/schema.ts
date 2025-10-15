import { boolean, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Enums
export const projectTypeEnum = pgEnum('project_type', ['adu', 'jadu']);
export const utilityTypeEnum = pgEnum('utility_type', ['municipal', 'onsite', 'none']);
export const ownershipTypeEnum = pgEnum('ownership_type', ['personal', 'business']);
export const agentTypeEnum = pgEnum('agent_type', ['individual', 'business']);
export const checklistAreaEnum = pgEnum('checklist_area', [
  'zoning_prep',
  'building_permit',
  'final_inspection',
  'post_clearance',
]);
export const checklistItemStatusEnum = pgEnum('checklist_item_status', [
  'not_started',
  'pending',
  'completed',
  'changes_requested',
  'waived',
]);
export const completionSourceEnum = pgEnum('completion_source', [
  'none',
  'document',
  'manual',
  'system',
]);
export const reviewStatusEnum = pgEnum('review_status', [
  'queued',
  'in_progress',
  'approved',
  'rejected',
  'needs_clarification',
  'error',
]);

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  emailVerified: boolean('emailVerified'),
  name: text('name'),
  image: text('image'),
  phoneNumber: text('phoneNumber'),
  role: text('role').default('user'),
  // Account lockout fields
  failedLoginAttempts: integer('failedLoginAttempts').default(0).notNull(),
  lastFailedLoginAt: timestamp('lastFailedLoginAt'),
  lockedUntil: timestamp('lockedUntil'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').unique().notNull(),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const authAccount = pgTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
});

// Central audit log
export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  entityType: text('entityType').notNull(),
  entityId: text('entityId'),
  metadata: text('metadata'),
  createdAt: timestamp('createdAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
});
