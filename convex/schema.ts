import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const parsedPdfImageValidator = v.object({
  pageNumber: v.number(),
  name: v.string(),
  width: v.number(),
  height: v.number(),
  dataUrl: v.string(),
});

const chatAttachmentKindValidator = v.union(v.literal('image'), v.literal('document'));
const chatAttachmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('error'),
);

const aiMessagePartValidator = v.union(
  v.object({
    type: v.literal('text'),
    text: v.string(),
  }),
  v.object({
    type: v.literal('image'),
    image: v.string(),
    mimeType: v.optional(v.string()),
    name: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('document'),
    name: v.string(),
    content: v.string(),
    mimeType: v.string(),
    images: v.optional(v.array(parsedPdfImageValidator)),
  }),
  v.object({
    type: v.literal('attachment'),
    attachmentId: v.id('aiAttachments'),
    kind: chatAttachmentKindValidator,
    name: v.string(),
    mimeType: v.string(),
  }),
  v.object({
    type: v.literal('source-url'),
    sourceId: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('source-document'),
    sourceId: v.string(),
    mediaType: v.string(),
    title: v.string(),
    filename: v.optional(v.string()),
  }),
);

const onboardingStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('email_pending'),
  v.literal('email_sent'),
  v.literal('delivered'),
  v.literal('delivery_delayed'),
  v.literal('bounced'),
  v.literal('completed'),
);

export default defineSchema({
  // Note: Better Auth manages its own tables via the betterAuth component
  // Those tables are in the 'betterAuth' namespace (user, session, account, verification, etc.)
  // We should NOT duplicate them here. Access Better Auth users via Better Auth APIs.

  users: defineTable({
    authUserId: v.string(),
    lastActiveOrganizationId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_auth_user_id', ['authUserId'])
    .index('by_last_active_organization_id', ['lastActiveOrganizationId']),

  userProfiles: defineTable({
    authUserId: v.string(),
    email: v.string(),
    emailLower: v.string(),
    name: v.union(v.string(), v.null()),
    nameLower: v.union(v.string(), v.null()),
    phoneNumber: v.union(v.string(), v.null()),
    role: v.union(v.literal('user'), v.literal('admin')),
    isSiteAdmin: v.boolean(),
    emailVerified: v.boolean(),
    banned: v.boolean(),
    banReason: v.union(v.string(), v.null()),
    banExpires: v.union(v.number(), v.null()),
    onboardingStatus: onboardingStatusValidator,
    onboardingEmailId: v.optional(v.string()),
    onboardingEmailMessageId: v.optional(v.string()),
    onboardingEmailLastSentAt: v.optional(v.number()),
    onboardingCompletedAt: v.optional(v.number()),
    onboardingDeliveryUpdatedAt: v.optional(v.number()),
    onboardingDeliveryError: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSyncedAt: v.number(),
  })
    .index('by_auth_user_id', ['authUserId'])
    .index('by_role', ['role'])
    .index('by_email_lower', ['emailLower'])
    .index('by_onboarding_email_id', ['onboardingEmailId'])
    .index('by_onboarding_email_message_id', ['onboardingEmailMessageId'])
    .index('by_created_at', ['createdAt']),

  userProfileSyncState: defineTable({
    key: v.string(),
    lastFullSyncAt: v.number(),
    totalUsers: v.number(),
  }).index('by_key', ['key']),

  emailLifecycleEvents: defineTable({
    messageId: v.string(),
    emailId: v.optional(v.string()),
    authUserId: v.optional(v.string()),
    email: v.string(),
    category: v.literal('onboarding'),
    eventType: v.string(),
    rawPayload: v.string(),
    occurredAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_message_id', ['messageId'])
    .index('by_auth_user_id', ['authUserId'])
    .index('by_email_id', ['emailId'])
    .index('by_occurred_at', ['occurredAt']),

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

  aiThreads: defineTable({
    userId: v.string(),
    organizationId: v.string(),
    title: v.string(),
    pinned: v.boolean(),
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    titleManuallyEdited: v.boolean(),
    contextSummary: v.optional(v.string()),
    contextSummaryThroughMessageId: v.optional(v.id('aiMessages')),
    contextSummaryUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index('by_organizationId_and_updatedAt', ['organizationId', 'updatedAt'])
    .index('by_organizationId_and_pinned', ['organizationId', 'pinned'])
    .index('by_organizationId_and_lastMessageAt', ['organizationId', 'lastMessageAt']),

  aiMessages: defineTable({
    threadId: v.id('aiThreads'),
    userId: v.string(),
    organizationId: v.string(),
    role: v.union(v.literal('assistant'), v.literal('user')),
    parts: v.array(aiMessagePartValidator),
    status: v.union(v.literal('pending'), v.literal('complete'), v.literal('error')),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    usage: v.optional(
      v.object({
        totalTokens: v.optional(v.number()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
      }),
    ),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    clientMessageId: v.optional(v.string()),
  })
    .index('by_threadId_and_createdAt', ['threadId', 'createdAt'])
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt']),

  aiAttachments: defineTable({
    messageId: v.optional(v.id('aiMessages')),
    threadId: v.optional(v.id('aiThreads')),
    userId: v.string(),
    organizationId: v.string(),
    kind: chatAttachmentKindValidator,
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    rawStorageId: v.optional(v.id('_storage')),
    extractedTextStorageId: v.optional(v.id('_storage')),
    promptSummary: v.string(),
    status: chatAttachmentStatusValidator,
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_messageId', ['messageId'])
    .index('by_threadId_and_createdAt', ['threadId', 'createdAt'])
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt']),

  aiMessageDrafts: defineTable({
    messageId: v.id('aiMessages'),
    threadId: v.id('aiThreads'),
    organizationId: v.string(),
    text: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_messageId', ['messageId'])
    .index('by_threadId', ['threadId'])
    .index('by_organizationId_and_updatedAt', ['organizationId', 'updatedAt']),

  aiPersonas: defineTable({
    userId: v.string(),
    organizationId: v.string(),
    name: v.string(),
    prompt: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt'])
    .index('by_userId_and_createdAt', ['userId', 'createdAt']),

  aiModelCatalog: defineTable({
    modelId: v.string(),
    label: v.string(),
    description: v.string(),
    task: v.string(),
    access: v.union(v.literal('public'), v.literal('admin')),
    supportsWebSearch: v.optional(v.boolean()),
    priceLabel: v.optional(v.string()),
    prices: v.optional(
      v.array(
        v.object({
          unit: v.string(),
          price: v.number(),
          currency: v.string(),
        }),
      ),
    ),
    contextWindow: v.optional(v.number()),
    source: v.string(),
    isActive: v.boolean(),
    refreshedAt: v.number(),
    beta: v.optional(v.boolean()),
    deprecated: v.optional(v.boolean()),
    deprecationDate: v.optional(v.string()),
  })
    .index('by_modelId', ['modelId'])
    .index('by_isActive', ['isActive'])
    .index('by_refreshedAt', ['refreshedAt']),
});
