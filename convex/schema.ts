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
    .index('by_email_verified', ['emailVerified'])
    .index('by_email_lower', ['emailLower'])
    .index('by_name_lower', ['nameLower'])
    .index('by_role_and_created_at', ['role', 'createdAt'])
    .index('by_role_and_email_verified', ['role', 'emailVerified'])
    .index('by_role_and_email_verified_and_name_lower', ['role', 'emailVerified', 'nameLower'])
    .index('by_role_and_email_verified_and_email_lower', ['role', 'emailVerified', 'emailLower'])
    .index('by_role_and_email_verified_and_created_at', ['role', 'emailVerified', 'createdAt'])
    .index('by_role_and_email_lower', ['role', 'emailLower'])
    .index('by_role_and_name_lower', ['role', 'nameLower'])
    .index('by_email_verified_and_role', ['emailVerified', 'role'])
    .index('by_email_verified_and_name_lower', ['emailVerified', 'nameLower'])
    .index('by_email_verified_and_email_lower', ['emailVerified', 'emailLower'])
    .index('by_email_verified_and_created_at', ['emailVerified', 'createdAt'])
    .index('by_onboarding_email_id', ['onboardingEmailId'])
    .index('by_onboarding_email_message_id', ['onboardingEmailMessageId'])
    .index('by_created_at', ['createdAt']),

  userProfileSyncState: defineTable({
    key: v.string(),
    lastFullSyncAt: v.number(),
    totalUsers: v.number(),
  }).index('by_key', ['key']),

  adminUserSearch: defineTable({
    authUserId: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')),
    searchText: v.string(),
    updatedAt: v.number(),
  })
    .index('by_auth_user_id', ['authUserId'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['role'],
    }),

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
    .index('by_result_status_and_created_at', ['resultStatus', 'createdAt'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_created_at', ['createdAt']),

  securityMetrics: defineTable({
    key: v.string(),
    totalDocumentScans: v.number(),
    quarantinedDocumentScans: v.number(),
    rejectedDocumentScans: v.number(),
    lastDocumentScanAt: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  securityFindings: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    findingKey: v.string(),
    findingType: v.union(
      v.literal('audit_integrity_failures'),
      v.literal('document_scan_quarantines'),
      v.literal('document_scan_rejections'),
      v.literal('release_security_validation'),
    ),
    title: v.string(),
    description: v.string(),
    severity: v.union(v.literal('info'), v.literal('warning'), v.literal('critical')),
    status: v.union(v.literal('open'), v.literal('resolved')),
    disposition: v.union(
      v.literal('pending_review'),
      v.literal('investigating'),
      v.literal('accepted_risk'),
      v.literal('false_positive'),
      v.literal('resolved'),
    ),
    sourceType: v.union(
      v.literal('audit_log'),
      v.literal('security_metric'),
      v.literal('security_control_evidence'),
    ),
    sourceLabel: v.string(),
    sourceRecordId: v.union(v.string(), v.null()),
    firstObservedAt: v.number(),
    lastObservedAt: v.number(),
    reviewNotes: v.optional(v.union(v.string(), v.null())),
    internalReviewNotes: v.optional(v.union(v.string(), v.null())),
    customerSummary: v.optional(v.union(v.string(), v.null())),
    reviewedAt: v.union(v.number(), v.null()),
    reviewedByUserId: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_finding_key', ['findingKey'])
    .index('by_updated_at', ['updatedAt'])
    .index('by_status_and_updated_at', ['status', 'updatedAt']),

  evidenceReports: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    generatedByUserId: v.string(),
    reportKind: v.union(
      v.literal('security_posture'),
      v.literal('audit_integrity'),
      v.literal('audit_readiness'),
      v.literal('annual_review'),
      v.literal('findings_snapshot'),
      v.literal('vendor_posture_snapshot'),
      v.literal('control_workspace_snapshot'),
    ),
    contentJson: v.string(),
    contentHash: v.string(),
    exportBundleJson: v.optional(v.string()),
    exportHash: v.optional(v.string()),
    exportIntegritySummary: v.optional(v.string()),
    exportManifestJson: v.optional(v.string()),
    exportManifestHash: v.optional(v.string()),
    latestExportArtifactId: v.optional(v.id('exportArtifacts')),
    exportedAt: v.union(v.number(), v.null()),
    exportedByUserId: v.union(v.string(), v.null()),
    reviewStatus: v.union(
      v.literal('pending'),
      v.literal('reviewed'),
      v.literal('needs_follow_up'),
    ),
    reviewedAt: v.union(v.number(), v.null()),
    reviewedByUserId: v.union(v.string(), v.null()),
    reviewNotes: v.optional(v.union(v.string(), v.null())),
    internalReviewNotes: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
  })
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_created_at', ['createdAt']),

  exportArtifacts: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    artifactType: v.union(
      v.literal('audit_csv'),
      v.literal('directory_csv'),
      v.literal('evidence_report_export'),
    ),
    organizationId: v.optional(v.string()),
    sourceReportId: v.optional(v.id('evidenceReports')),
    exportedByUserId: v.string(),
    manifestJson: v.string(),
    manifestHash: v.string(),
    payloadJson: v.string(),
    payloadHash: v.string(),
    exportedAt: v.number(),
    createdAt: v.number(),
    schemaVersion: v.string(),
  })
    .index('by_artifact_type_and_created_at', ['artifactType', 'createdAt'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_source_report_id', ['sourceReportId']),

  securityControlChecklistItems: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    internalControlId: v.string(),
    itemId: v.string(),
    manualStatus: v.optional(
      v.union(
        v.literal('not_started'),
        v.literal('in_progress'),
        v.literal('done'),
        v.literal('not_applicable'),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal('not_started'),
        v.literal('in_progress'),
        v.literal('done'),
        v.literal('not_applicable'),
      ),
    ),
    owner: v.optional(v.string()),
    notes: v.optional(v.string()),
    internalOperatorNotes: v.optional(v.string()),
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
    reviewSatisfaction: v.optional(
      v.object({
        reviewRunId: v.id('reviewRuns'),
        reviewTaskId: v.id('reviewTasks'),
        satisfiedAt: v.number(),
        satisfiedThroughAt: v.number(),
        satisfiedByUserId: v.string(),
        mode: v.union(
          v.literal('automated_check'),
          v.literal('attestation'),
          v.literal('document_upload'),
          v.literal('follow_up'),
          v.literal('exception'),
        ),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_internal_control_id', ['internalControlId'])
    .index('by_internal_control_id_and_item_id', ['internalControlId', 'itemId']),

  securityControlEvidence: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
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
    evidenceDate: v.optional(v.number()),
    reviewDueIntervalMonths: v.optional(v.union(v.literal(3), v.literal(6), v.literal(12))),
    source: v.optional(
      v.union(
        v.literal('manual_upload'),
        v.literal('internal_review'),
        v.literal('automated_system_check'),
        v.literal('external_report'),
        v.literal('vendor_attestation'),
      ),
    ),
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

  securityControlEvidenceActivity: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    auditEventId: v.string(),
    createdAt: v.number(),
    actorUserId: v.union(v.string(), v.null()),
    eventType: v.union(
      v.literal('security_control_evidence_created'),
      v.literal('security_control_evidence_reviewed'),
      v.literal('security_control_evidence_archived'),
      v.literal('security_control_evidence_renewed'),
    ),
    evidenceId: v.string(),
    evidenceTitle: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
    lifecycleStatus: v.union(
      v.literal('active'),
      v.literal('archived'),
      v.literal('superseded'),
      v.null(),
    ),
    renewedFromEvidenceId: v.union(v.string(), v.null()),
    replacedByEvidenceId: v.union(v.string(), v.null()),
    reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.null()),
  })
    .index('by_audit_event_id', ['auditEventId'])
    .index('by_internal_control_id_and_item_id_and_created_at', [
      'internalControlId',
      'itemId',
      'createdAt',
    ]),

  reviewRuns: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    kind: v.union(v.literal('annual'), v.literal('triggered')),
    status: v.union(v.literal('ready'), v.literal('needs_attention'), v.literal('completed')),
    title: v.string(),
    runKey: v.string(),
    year: v.optional(v.number()),
    triggerType: v.optional(v.string()),
    sourceRecordType: v.optional(v.string()),
    sourceRecordId: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    controlRegisterGeneratedAt: v.string(),
    controlRegisterSchemaVersion: v.string(),
    snapshotHash: v.string(),
    snapshotJson: v.string(),
    finalReportId: v.optional(v.id('evidenceReports')),
    createdAt: v.number(),
    createdByUserId: v.string(),
    finalizedAt: v.optional(v.number()),
    finalizedByUserId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_run_key', ['runKey'])
    .index('by_kind_and_created_at', ['kind', 'createdAt'])
    .index('by_dedupe_key', ['dedupeKey']),

  reviewTasks: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    reviewRunId: v.id('reviewRuns'),
    templateKey: v.string(),
    title: v.string(),
    description: v.string(),
    taskType: v.union(
      v.literal('automated_check'),
      v.literal('attestation'),
      v.literal('document_upload'),
      v.literal('follow_up'),
    ),
    status: v.union(
      v.literal('ready'),
      v.literal('completed'),
      v.literal('exception'),
      v.literal('blocked'),
    ),
    controlLinks: v.array(
      v.object({
        internalControlId: v.string(),
        itemId: v.string(),
      }),
    ),
    required: v.boolean(),
    allowException: v.boolean(),
    freshnessWindowDays: v.optional(v.number()),
    satisfiedAt: v.optional(v.number()),
    satisfiedThroughAt: v.optional(v.number()),
    latestResultId: v.optional(v.id('reviewTaskResults')),
    latestAttestationId: v.optional(v.id('reviewAttestations')),
    latestNote: v.optional(v.string()),
    latestEvidenceLinkedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_review_run_id', ['reviewRunId'])
    .index('by_review_run_id_and_template_key', ['reviewRunId', 'templateKey']),

  reviewTaskResults: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    reviewRunId: v.id('reviewRuns'),
    reviewTaskId: v.id('reviewTasks'),
    resultType: v.union(
      v.literal('automated_check'),
      v.literal('attested'),
      v.literal('document_linked'),
      v.literal('exception_marked'),
      v.literal('follow_up_opened'),
      v.literal('resolved'),
    ),
    statusAfter: v.union(
      v.literal('ready'),
      v.literal('completed'),
      v.literal('exception'),
      v.literal('blocked'),
    ),
    note: v.optional(v.string()),
    actorUserId: v.string(),
    createdAt: v.number(),
  })
    .index('by_review_task_id_and_created_at', ['reviewTaskId', 'createdAt'])
    .index('by_review_run_id_and_created_at', ['reviewRunId', 'createdAt']),

  reviewAttestations: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    reviewRunId: v.id('reviewRuns'),
    reviewTaskId: v.id('reviewTasks'),
    statementKey: v.string(),
    statementText: v.string(),
    attestedAt: v.number(),
    attestedByUserId: v.string(),
    documentLabel: v.optional(v.string()),
    documentUrl: v.optional(v.string()),
    documentVersion: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_review_task_id', ['reviewTaskId'])
    .index('by_review_run_id_and_attested_at', ['reviewRunId', 'attestedAt']),

  reviewTaskEvidenceLinks: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    reviewRunId: v.id('reviewRuns'),
    reviewTaskId: v.id('reviewTasks'),
    sourceType: v.union(
      v.literal('security_control_evidence'),
      v.literal('evidence_report'),
      v.literal('security_finding'),
      v.literal('backup_verification_report'),
      v.literal('external_document'),
      v.literal('review_task'),
      v.literal('vendor_review'),
    ),
    sourceId: v.string(),
    sourceLabel: v.optional(v.string()),
    role: v.union(v.literal('primary'), v.literal('supporting'), v.literal('blocking')),
    linkedAt: v.number(),
    linkedByUserId: v.optional(v.string()),
    freshAt: v.optional(v.number()),
  })
    .index('by_review_task_id', ['reviewTaskId'])
    .index('by_review_run_id_and_linked_at', ['reviewRunId', 'linkedAt'])
    .index('by_source_type_and_source_id', ['sourceType', 'sourceId']),

  securityVendorReviews: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    vendorKey: v.union(v.literal('openrouter'), v.literal('resend'), v.literal('sentry')),
    owner: v.optional(v.string()),
    reviewStatus: v.union(
      v.literal('pending'),
      v.literal('reviewed'),
      v.literal('needs_follow_up'),
    ),
    reviewNotes: v.optional(v.union(v.string(), v.null())),
    internalReviewNotes: v.optional(v.union(v.string(), v.null())),
    customerSummary: v.optional(v.union(v.string(), v.null())),
    reviewedAt: v.union(v.number(), v.null()),
    reviewedByUserId: v.union(v.string(), v.null()),
    linkedFollowUpRunId: v.optional(v.id('reviewRuns')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_vendor_key', ['vendorKey'])
    .index('by_review_status_and_updated_at', ['reviewStatus', 'updatedAt']),

  securityRelationships: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    fromType: v.union(
      v.literal('control'),
      v.literal('checklist_item'),
      v.literal('evidence'),
      v.literal('finding'),
      v.literal('vendor_review'),
      v.literal('review_run'),
      v.literal('review_task'),
      v.literal('evidence_report'),
    ),
    fromId: v.string(),
    toType: v.union(
      v.literal('control'),
      v.literal('checklist_item'),
      v.literal('evidence'),
      v.literal('finding'),
      v.literal('vendor_review'),
      v.literal('review_run'),
      v.literal('review_task'),
      v.literal('evidence_report'),
    ),
    toId: v.string(),
    relationshipType: v.union(
      v.literal('has_evidence'),
      v.literal('tracks_finding'),
      v.literal('tracks_vendor_review'),
      v.literal('has_review_task'),
      v.literal('has_report'),
      v.literal('supports'),
      v.literal('satisfies'),
      v.literal('follow_up_for'),
      v.literal('related_control'),
    ),
    createdAt: v.number(),
    createdByUserId: v.string(),
  })
    .index('by_from', ['fromType', 'fromId'])
    .index('by_to', ['toType', 'toId'])
    .index('by_relationship_and_created_at', ['relationshipType', 'createdAt']),

  organizationAuditEvents: defineTable({
    auditEventId: v.string(),
    eventType: v.string(),
    label: v.string(),
    actorLabel: v.union(v.string(), v.null()),
    targetLabel: v.union(v.string(), v.null()),
    summary: v.union(v.string(), v.null()),
    userId: v.union(v.string(), v.null()),
    actorUserId: v.union(v.string(), v.null()),
    targetUserId: v.union(v.string(), v.null()),
    organizationId: v.string(),
    identifier: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
    requestId: v.union(v.string(), v.null()),
    outcome: v.union(v.literal('success'), v.literal('failure'), v.null()),
    severity: v.union(v.literal('info'), v.literal('warning'), v.literal('critical'), v.null()),
    resourceType: v.union(v.string(), v.null()),
    resourceId: v.union(v.string(), v.null()),
    resourceLabel: v.union(v.string(), v.null()),
    sourceSurface: v.union(v.string(), v.null()),
    eventHash: v.union(v.string(), v.null()),
    previousEventHash: v.union(v.string(), v.null()),
    metadata: v.union(v.string(), v.null()),
    createdAt: v.number(),
    ipAddress: v.union(v.string(), v.null()),
    userAgent: v.union(v.string(), v.null()),
  })
    .index('by_audit_event_id', ['auditEventId'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_organization_id_and_event_type_and_created_at', [
      'organizationId',
      'eventType',
      'createdAt',
    ])
    .index('by_organization_id_and_identifier_and_created_at', [
      'organizationId',
      'identifier',
      'createdAt',
    ])
    .index('by_organization_id_and_user_id_and_created_at', [
      'organizationId',
      'userId',
      'createdAt',
    ]),

  retentionJobs: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
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
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    drillId: v.string(),
    drillType: v.union(v.literal('operator_recorded'), v.literal('restore_verification')),
    sourceDataset: v.string(),
    targetEnvironment: v.union(
      v.literal('development'),
      v.literal('production'),
      v.literal('test'),
    ),
    initiatedByUserId: v.union(v.string(), v.null()),
    initiatedByKind: v.union(v.literal('system'), v.literal('user')),
    verificationMethod: v.string(),
    evidenceSummary: v.string(),
    restoredItemCount: v.number(),
    failureReason: v.union(v.string(), v.null()),
    artifactHash: v.union(v.string(), v.null()),
    artifactContentJson: v.union(v.string(), v.null()),
    status: v.union(v.literal('success'), v.literal('failure')),
    summary: v.string(),
    checkedAt: v.number(),
    createdAt: v.number(),
  })
    .index('by_checked_at', ['checkedAt'])
    .index('by_drill_id', ['drillId']),
});
