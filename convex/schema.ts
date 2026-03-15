import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const chatAttachmentKindValidator = v.union(v.literal('image'), v.literal('document'));
const chatAttachmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('ready'),
  v.literal('error'),
);
const chatRunStatusValidator = v.union(
  v.literal('idle'),
  v.literal('streaming'),
  v.literal('complete'),
  v.literal('aborted'),
  v.literal('error'),
);
const chatRunFailureKindValidator = v.union(
  v.literal('provider_policy'),
  v.literal('provider_unavailable'),
  v.literal('tool_error'),
  v.literal('unknown'),
);
const chatThreadVisibilityValidator = v.union(v.literal('private'), v.literal('shared'));
const chatUsageOperationKindValidator = v.union(
  v.literal('chat_turn'),
  v.literal('web_search'),
  v.literal('thread_title'),
  v.literal('thread_summary'),
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
    .index('by_name_lower', ['nameLower'])
    .index('by_role_and_created_at', ['role', 'createdAt'])
    .index('by_role_and_email_lower', ['role', 'emailLower'])
    .index('by_role_and_name_lower', ['role', 'nameLower'])
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
    eventType: v.string(),
    userId: v.optional(v.string()), // References Better Auth user.id when the event resolves to one
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_createdAt', ['createdAt'])
    .index('by_eventType_and_createdAt', ['eventType', 'createdAt'])
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt'])
    .index('by_organizationId_and_eventType_and_createdAt', [
      'organizationId',
      'eventType',
      'createdAt',
    ])
    .index('by_identifier_and_createdAt', ['identifier', 'createdAt']),

  organizationDomains: defineTable({
    organizationId: v.string(),
    domain: v.string(),
    normalizedDomain: v.string(),
    status: v.union(v.literal('pending_verification'), v.literal('verified')),
    verificationMethod: v.literal('dns_txt'),
    verificationToken: v.string(),
    verifiedAt: v.union(v.number(), v.null()),
    createdByUserId: v.string(),
    createdAt: v.number(),
  })
    .index('by_organization_id', ['organizationId'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_normalized_domain', ['normalizedDomain']),

  organizationPolicies: defineTable({
    organizationId: v.string(),
    invitePolicy: v.union(v.literal('owners_admins'), v.literal('owners_only')),
    verifiedDomainsOnly: v.boolean(),
    memberCap: v.union(v.number(), v.null()),
    mfaRequired: v.boolean(),
    enterpriseAuthMode: v.union(v.literal('off'), v.literal('optional'), v.literal('required')),
    enterpriseProviderKey: v.union(
      v.literal('google-workspace'),
      v.literal('entra'),
      v.literal('okta'),
      v.null(),
    ),
    enterpriseProtocol: v.union(v.literal('oidc'), v.null()),
    enterpriseEnabledAt: v.union(v.number(), v.null()),
    enterpriseEnforcedAt: v.union(v.number(), v.null()),
    allowBreakGlassPasswordLogin: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organization_id', ['organizationId'])
    .index('by_organization_id_and_updated_at', ['organizationId', 'updatedAt']),

  organizationMembershipStates: defineTable({
    organizationId: v.string(),
    membershipId: v.string(),
    userId: v.string(),
    status: v.union(v.literal('suspended'), v.literal('deactivated')),
    reason: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedByUserId: v.string(),
    deactivatedAt: v.optional(v.number()),
    reactivatedAt: v.optional(v.number()),
  })
    .index('by_membership_id', ['membershipId'])
    .index('by_organization_id_and_user_id', ['organizationId', 'userId'])
    .index('by_organization_id_and_status', ['organizationId', 'status']),

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

  chatThreads: defineTable({
    ownerUserId: v.string(),
    organizationId: v.string(),
    agentThreadId: v.string(),
    title: v.string(),
    pinned: v.boolean(),
    visibility: chatThreadVisibilityValidator,
    personaId: v.optional(v.id('aiPersonas')),
    model: v.optional(v.string()),
    titleManuallyEdited: v.boolean(),
    summary: v.optional(v.string()),
    summaryUpdatedAt: v.optional(v.number()),
    summaryThroughOrder: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index('by_agentThreadId', ['agentThreadId'])
    .index('by_organizationId_and_personaId', ['organizationId', 'personaId'])
    .index('by_organizationId_and_updatedAt', ['organizationId', 'updatedAt'])
    .index('by_organizationId_and_visibility_and_updatedAt', [
      'organizationId',
      'visibility',
      'updatedAt',
    ])
    .index('by_organizationId_and_pinned', ['organizationId', 'pinned'])
    .index('by_organizationId_and_lastMessageAt', ['organizationId', 'lastMessageAt'])
    .index('by_organizationId_and_visibility_and_lastMessageAt', [
      'organizationId',
      'visibility',
      'lastMessageAt',
    ])
    .index('by_ownerUserId_and_updatedAt', ['ownerUserId', 'updatedAt'])
    .index('by_ownerUserId_and_lastMessageAt', ['ownerUserId', 'lastMessageAt']),

  chatRuns: defineTable({
    threadId: v.id('chatThreads'),
    agentThreadId: v.string(),
    organizationId: v.string(),
    initiatedByUserId: v.string(),
    ownerSessionId: v.string(),
    agentStreamId: v.optional(v.string()),
    status: chatRunStatusValidator,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    failureKind: v.optional(chatRunFailureKindValidator),
    activeAssistantMessageId: v.optional(v.string()),
    promptMessageId: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    useWebSearch: v.boolean(),
    actualInputTokens: v.optional(v.number()),
    actualOutputTokens: v.optional(v.number()),
    actualTotalTokens: v.optional(v.number()),
    usageEventCount: v.optional(v.number()),
    usageRecordedAt: v.optional(v.number()),
  })
    .index('by_threadId_and_startedAt', ['threadId', 'startedAt'])
    .index('by_threadId_and_status', ['threadId', 'status'])
    .index('by_status_and_startedAt', ['status', 'startedAt'])
    .index('by_ownerSessionId_and_startedAt', ['ownerSessionId', 'startedAt'])
    .index('by_initiatedByUserId_and_startedAt', ['initiatedByUserId', 'startedAt']),

  chatUsageEvents: defineTable({
    organizationId: v.string(),
    actorUserId: v.string(),
    threadOwnerUserId: v.string(),
    threadId: v.id('chatThreads'),
    runId: v.optional(v.id('chatRuns')),
    agentThreadId: v.string(),
    agentName: v.optional(v.string()),
    operationKind: chatUsageOperationKindValidator,
    model: v.string(),
    provider: v.string(),
    totalTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    providerMetadataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_threadId_and_createdAt', ['threadId', 'createdAt'])
    .index('by_runId_and_createdAt', ['runId', 'createdAt'])
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt'])
    .index('by_actorUserId_and_createdAt', ['actorUserId', 'createdAt'])
    .index('by_threadOwnerUserId_and_createdAt', ['threadOwnerUserId', 'createdAt'])
    .index('by_operationKind_and_createdAt', ['operationKind', 'createdAt']),

  chatAttachments: defineTable({
    threadId: v.optional(v.id('chatThreads')),
    agentMessageId: v.optional(v.string()),
    userId: v.string(),
    organizationId: v.string(),
    kind: chatAttachmentKindValidator,
    name: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    rawStorageId: v.optional(v.id('_storage')),
    extractedTextStorageId: v.optional(v.id('_storage')),
    agentFileId: v.optional(v.string()),
    promptSummary: v.string(),
    status: chatAttachmentStatusValidator,
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_threadId_and_createdAt', ['threadId', 'createdAt'])
    .index('by_organizationId_and_threadId_and_createdAt', [
      'organizationId',
      'threadId',
      'createdAt',
    ])
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt']),

  chatAttachmentUploadTokens: defineTable({
    token: v.string(),
    userId: v.string(),
    organizationId: v.string(),
    sessionId: v.string(),
    expectedFileName: v.string(),
    expectedMimeType: v.string(),
    expectedSizeBytes: v.number(),
    expectedSha256: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_expiresAt', ['expiresAt']),

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
