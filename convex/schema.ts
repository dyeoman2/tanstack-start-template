import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Note: Better Auth manages its own tables via the betterAuth component
  // Those tables are in the 'betterAuth' namespace (user, session, account, verification, etc.)
  // We should NOT duplicate them here. Access Better Auth users via Better Auth APIs.

  // Application-specific tables only
  // User profiles table - stores app-specific user data that references Better Auth user IDs
  userProfiles: defineTable({
    userId: v.string(), // References Better Auth user.id
    role: v.string(), // Application-specific: 'user' | 'admin'
    // Add other app-specific user fields here as needed
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_userId', ['userId']),

  auditLogs: defineTable({
    id: v.string(),
    userId: v.string(), // References Better Auth user.id
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_createdAt', ['createdAt']),
});
