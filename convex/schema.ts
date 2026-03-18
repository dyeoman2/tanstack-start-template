import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const chatAttachmentKindValidator = v.union(v.literal('image'), v.literal('document'));
const storageBackendModeValidator = v.union(
  v.literal('convex'),
  v.literal('s3-primary'),
  v.literal('s3-mirror'),
);
const storageLifecycleMalwareStatusValidator = v.union(
  v.literal('NOT_STARTED'),
  v.literal('PENDING'),
  v.literal('CLEAN'),
  v.literal('INFECTED'),
  v.literal('QUARANTINED_UNSCANNED'),
);
const storageLifecycleMirrorStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('MIRRORED'),
  v.literal('FAILED'),
);
const storageLifecycleQuarantineReasonValidator = v.union(
  v.literal('INFECTED'),
  v.literal('QUARANTINED_UNSCANNED'),
);
const chatAttachmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('pending_scan'),
  v.literal('quarantined'),
  v.literal('ready'),
  v.literal('error'),
  v.literal('rejected'),
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
    actorUserId: v.optional(v.string()),
    targetUserId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    identifier: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    outcome: v.optional(v.union(v.literal('success'), v.literal('failure'))),
    severity: v.optional(v.union(v.literal('info'), v.literal('warning'), v.literal('critical'))),
    resourceType: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    resourceLabel: v.optional(v.string()),
    sourceSurface: v.optional(v.string()),
    eventHash: v.optional(v.string()),
    previousEventHash: v.optional(v.string()),
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
    auditExportRequiresStepUp: v.boolean(),
    attachmentSharingAllowed: v.boolean(),
    dataRetentionDays: v.number(),
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
    temporaryLinkTtlMinutes: v.number(),
    webSearchAllowed: v.boolean(),
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
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.string()),
    purgeEligibleAt: v.optional(v.number()),
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
    storageId: v.string(),
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
    deletedAt: v.optional(v.number()),
    deletedByUserId: v.optional(v.string()),
    purgeEligibleAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_threadId_and_createdAt', ['threadId', 'createdAt'])
    .index('by_organizationId_and_threadId_and_createdAt', [
      'organizationId',
      'threadId',
      'createdAt',
    ])
    .index('by_storageId', ['storageId'])
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_organizationId_and_createdAt', ['organizationId', 'createdAt'])
    .index('by_purgeEligibleAt', ['purgeEligibleAt']),

  chatAttachmentUploadTokens: defineTable({
    token: v.string(),
    storageId: v.string(),
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

  storageLifecycle: defineTable({
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    storageId: v.string(),
    sourceType: v.string(),
    sourceId: v.string(),
    backendMode: storageBackendModeValidator,
    originalFileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    canonicalBucket: v.optional(v.string()),
    canonicalKey: v.optional(v.string()),
    canonicalVersionId: v.optional(v.string()),
    mirrorBucket: v.optional(v.string()),
    mirrorKey: v.optional(v.string()),
    mirrorVersionId: v.optional(v.string()),
    malwareStatus: v.optional(storageLifecycleMalwareStatusValidator),
    mirrorStatus: v.optional(storageLifecycleMirrorStatusValidator),
    mirrorAttempts: v.optional(v.number()),
    mirrorLastError: v.optional(v.string()),
    mirrorDeadlineAt: v.optional(v.number()),
    malwareFindingId: v.optional(v.string()),
    malwareScannedAt: v.optional(v.number()),
    malwareDetectedAt: v.optional(v.number()),
    quarantinedAt: v.optional(v.number()),
    quarantineReason: v.optional(storageLifecycleQuarantineReasonValidator),
    uploadedById: v.optional(v.id('users')),
  })
    .index('by_storageId', ['storageId'])
    .index('by_source', ['sourceType', 'sourceId'])
    .index('by_s3Key', ['canonicalBucket', 'canonicalKey'])
    .index('by_mirrorDeadlineAt', ['mirrorDeadlineAt'])
    .index('by_malwareStatus', ['malwareStatus'])
    .index('by_deletedAt', ['deletedAt']),

  storageLifecycleEvents: defineTable({
    storageLifecycleId: v.id('storageLifecycle'),
    storageId: v.string(),
    sourceType: v.string(),
    sourceId: v.string(),
    eventType: v.string(),
    actionResult: v.union(v.literal('success'), v.literal('failure')),
    details: v.optional(v.string()),
    actorUserId: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_storageId_createdAt', ['storageId', 'createdAt'])
    .index('by_source_createdAt', ['sourceType', 'sourceId', 'createdAt'])
    .index('by_eventType_createdAt', ['eventType', 'createdAt']),

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

  userSecurityPosture: defineTable({
    authUserId: v.string(),
    mfaEnabled: v.boolean(),
    passkeyCount: v.number(),
    recentStepUpAt: v.union(v.number(), v.null()),
    recentStepUpValidUntil: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  }).index('by_auth_user_id', ['authUserId']),

  documentScanEvents: defineTable({
    attachmentId: v.optional(v.id('chatAttachments')),
    fileName: v.string(),
    mimeType: v.string(),
    organizationId: v.string(),
    requestedByUserId: v.string(),
    resultStatus: v.union(
      v.literal('accepted'),
      v.literal('inspection_failed'),
      v.literal('quarantined'),
      v.literal('rejected'),
    ),
    details: v.union(v.string(), v.null()),
    scannerEngine: v.string(),
    scannedAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_attachment_id', ['attachmentId'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_created_at', ['createdAt']),

  evidenceReports: defineTable({
    organizationId: v.optional(v.string()),
    generatedByUserId: v.string(),
    reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
    contentJson: v.string(),
    contentHash: v.string(),
    exportBundleJson: v.optional(v.string()),
    exportHash: v.optional(v.string()),
    exportIntegritySummary: v.optional(v.string()),
    exportedAt: v.union(v.number(), v.null()),
    exportedByUserId: v.union(v.string(), v.null()),
    reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
    reviewedAt: v.union(v.number(), v.null()),
    reviewedByUserId: v.union(v.string(), v.null()),
    reviewNotes: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_created_at', ['createdAt']),

  securityControlStates: defineTable({
    internalControlId: v.string(),
    reviewNotes: v.optional(v.string()),
    reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
    reviewedAt: v.optional(v.number()),
    reviewedByUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_internal_control_id', ['internalControlId']),

  securityControlChecklistItems: defineTable({
    internalControlId: v.string(),
    itemId: v.string(),
    status: v.union(
      v.literal('not_started'),
      v.literal('in_progress'),
      v.literal('done'),
      v.literal('not_applicable'),
    ),
    owner: v.optional(v.string()),
    notes: v.optional(v.string()),
    hiddenSeedEvidenceIds: v.optional(v.array(v.string())),
    archivedSeedEvidence: v.optional(
      v.array(
        v.object({
          evidenceId: v.string(),
          lifecycleStatus: v.union(v.literal('archived'), v.literal('superseded')),
          archivedAt: v.number(),
          archivedByUserId: v.string(),
          replacedByEvidenceId: v.optional(v.string()),
        }),
      ),
    ),
    completedAt: v.optional(v.number()),
    completedByUserId: v.optional(v.string()),
    lastReviewedAt: v.optional(v.number()),
    lastReviewedByUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_internal_control_id', ['internalControlId'])
    .index('by_internal_control_id_and_item_id', ['internalControlId', 'itemId']),

  securityControlEvidence: defineTable({
    internalControlId: v.string(),
    itemId: v.string(),
    evidenceType: v.union(
      v.literal('file'),
      v.literal('link'),
      v.literal('note'),
      v.literal('system_snapshot'),
    ),
    title: v.string(),
    description: v.optional(v.string()),
    url: v.optional(v.string()),
    storageId: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    sufficiency: v.union(v.literal('missing'), v.literal('partial'), v.literal('sufficient')),
    uploadedByUserId: v.string(),
    reviewStatus: v.optional(v.union(v.literal('pending'), v.literal('reviewed'))),
    reviewedAt: v.optional(v.number()),
    reviewedByUserId: v.optional(v.string()),
    lifecycleStatus: v.optional(
      v.union(v.literal('active'), v.literal('archived'), v.literal('superseded')),
    ),
    archivedAt: v.optional(v.number()),
    archivedByUserId: v.optional(v.string()),
    replacedByEvidenceId: v.optional(v.string()),
    renewedFromEvidenceId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_internal_control_id', ['internalControlId'])
    .index('by_internal_control_id_and_item_id', ['internalControlId', 'itemId']),

  retentionJobs: defineTable({
    jobKind: v.union(
      v.literal('attachment_purge'),
      v.literal('quarantine_cleanup'),
      v.literal('audit_export_cleanup'),
    ),
    status: v.union(v.literal('success'), v.literal('failure')),
    details: v.optional(v.string()),
    processedCount: v.number(),
    createdAt: v.number(),
  })
    .index('by_job_kind_and_created_at', ['jobKind', 'createdAt'])
    .index('by_created_at', ['createdAt']),

  backupVerificationReports: defineTable({
    status: v.union(v.literal('success'), v.literal('failure')),
    summary: v.string(),
    checkedAt: v.number(),
    createdAt: v.number(),
  }).index('by_checked_at', ['checkedAt']),
});
