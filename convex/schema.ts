import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Note: Better Auth manages its own tables via the betterAuth component
  // Those tables are in the 'betterAuth' namespace (user, session, account, verification, etc.)
  // We should NOT duplicate them here. Access Better Auth users via Better Auth APIs.

  users: defineTable({
    authUserId: v.string(),
    lastActiveTeamId: v.optional(v.id('teams')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_auth_user_id', ['authUserId'])
    .index('by_last_active_team_id', ['lastActiveTeamId']),

  teams: defineTable({
    name: v.string(),
    createdById: v.id('users'),
    updatedById: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_created_by_id', ['createdById']),

  teamUsers: defineTable({
    userId: v.id('users'),
    teamId: v.id('teams'),
    role: v.union(v.literal('admin'), v.literal('edit'), v.literal('view')),
    createdById: v.id('users'),
    updatedById: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_team', ['teamId'])
    .index('by_user_team', ['userId', 'teamId']),

  teamInvites: defineTable({
    teamId: v.id('teams'),
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('edit'), v.literal('view')),
    token: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('revoked'),
      v.literal('expired'),
    ),
    invitedById: v.id('users'),
    acceptedById: v.optional(v.id('users')),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_team', ['teamId'])
    .index('by_email', ['email'])
    .index('by_team_email', ['teamId', 'email']),

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

  dashboardStats: defineTable({
    key: v.string(),
    totalUsers: v.number(),
    activeUsers: v.number(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // Rate limiting table - managed by @convex-dev/rate-limiter
  rateLimit: defineTable({
    identifier: v.string(),
    kind: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_identifier_kind', ['identifier', 'kind'])
    .index('by_createdAt', ['createdAt']),

  aiMessageUsage: defineTable({
    userId: v.string(),
    teamId: v.optional(v.id('teams')),
    messagesUsed: v.number(),
    pendingMessages: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReservedAt: v.optional(v.number()),
    lastCompletedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_teamId', ['teamId']),

  aiResponses: defineTable({
    userId: v.string(),
    teamId: v.optional(v.id('teams')),
    requestKey: v.string(),
    method: v.union(v.literal('direct'), v.literal('gateway'), v.literal('structured')),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    response: v.string(),
    rawText: v.optional(v.string()),
    structuredData: v.optional(
      v.object({
        title: v.string(),
        summary: v.string(),
        keyPoints: v.array(v.string()),
        category: v.string(),
        difficulty: v.string(),
      }),
    ),
    parseError: v.optional(v.string()),
    usage: v.optional(
      v.object({
        totalTokens: v.optional(v.number()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
      }),
    ),
    finishReason: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('complete'), v.literal('error')),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_teamId_createdAt', ['teamId', 'createdAt'])
    .index('by_requestKey', ['requestKey']),
});
