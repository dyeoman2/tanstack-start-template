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
const storageLifecycleInspectionStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('PASSED'),
  v.literal('REJECTED'),
  v.literal('FAILED'),
);
const storageLifecycleInspectionReasonValidator = v.union(
  v.literal('archive_encrypted'),
  v.literal('archive_suspicious_structure'),
  v.literal('checksum_mismatch'),
  v.literal('file_signature_mismatch'),
  v.literal('inspection_error'),
  v.literal('office_macro_enabled'),
  v.literal('office_password_protected'),
  v.literal('ooxml_embedded_content'),
  v.literal('ooxml_external_relationship'),
  v.literal('ooxml_malformed'),
  v.literal('pdf_active_content'),
  v.literal('pdf_embedded_files'),
  v.literal('pdf_encrypted'),
  v.literal('pdf_javascript'),
  v.literal('pdf_launch_action'),
  v.literal('pdf_malformed'),
  v.literal('pdf_open_action'),
  v.literal('pdf_rich_media'),
  v.literal('pdf_xfa'),
  v.literal('size_limit_exceeded'),
  v.literal('unsupported_type'),
);
const storageLifecycleMirrorStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('MIRRORED'),
  v.literal('FAILED'),
);
const storageLifecycleQuarantineReasonValidator = v.union(
  v.literal('INFECTED'),
  v.literal('QUARANTINED_UNSCANNED'),
  v.literal('INSPECTION_REJECTED'),
);
const storageLifecyclePlacementValidator = v.union(
  v.literal('QUARANTINE'),
  v.literal('PROMOTED'),
  v.literal('REJECTED'),
);
const chatAttachmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('pending_scan'),
  v.literal('processing'),
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
const pdfParseJobStatusValidator = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('ready'),
  v.literal('failed'),
  v.literal('quarantined'),
);
const organizationLegalHoldStatusValidator = v.union(v.literal('active'), v.literal('released'));
const retentionDeletionJobKindValidator = v.union(
  v.literal('temporary_artifact_purge'),
  v.literal('phi_record_purge'),
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

  auditLedgerEvents: defineTable({
    chainId: v.string(),
    id: v.string(),
    sequence: v.number(),
    eventType: v.string(),
    provenance: v.object({
      kind: v.union(
        v.literal('user'),
        v.literal('site_admin'),
        v.literal('system'),
        v.literal('scim_service'),
      ),
      emitter: v.string(),
      actorUserId: v.optional(v.string()),
      sessionId: v.optional(v.string()),
      identifier: v.optional(v.string()),
      initiatedByUserId: v.optional(v.string()),
      scimProviderId: v.optional(v.string()),
    }),
    userId: v.optional(v.string()),
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
    eventHash: v.string(),
    previousEventHash: v.union(v.string(), v.null()),
    metadata: v.optional(v.string()),
    recordedAt: v.number(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index('by_sequence', ['chainId', 'sequence'])
    .index('by_recordedAt', ['chainId', 'recordedAt'])
    .index('by_eventType_and_sequence', ['chainId', 'eventType', 'sequence'])
    .index('by_organizationId_and_sequence', ['organizationId', 'sequence'])
    .index('by_userId_and_sequence', ['userId', 'sequence'])
    .index('by_identifier_and_sequence', ['identifier', 'sequence']),

  auditLedgerState: defineTable({
    chainId: v.string(),
    chainVersion: v.number(),
    headSequence: v.number(),
    headEventHash: v.union(v.string(), v.null()),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index('by_chain_id', ['chainId']),

  auditLedgerCheckpoints: defineTable({
    chainId: v.string(),
    startSequence: v.number(),
    endSequence: v.number(),
    headHash: v.union(v.string(), v.null()),
    status: v.union(v.literal('ok'), v.literal('failed')),
    checkedAt: v.number(),
    verifiedEventCount: v.number(),
    failure: v.optional(
      v.object({
        actualEventHash: v.union(v.string(), v.null()),
        actualPreviousEventHash: v.union(v.string(), v.null()),
        eventId: v.string(),
        expectedPreviousEventHash: v.union(v.string(), v.null()),
        expectedSequence: v.number(),
        recomputedEventHash: v.string(),
      }),
    ),
  })
    .index('by_chain_id_and_checked_at', ['chainId', 'checkedAt'])
    .index('by_chain_id_and_status_and_checked_at', ['chainId', 'status', 'checkedAt']),

  auditLedgerSeals: defineTable({
    chainId: v.string(),
    startSequence: v.number(),
    endSequence: v.number(),
    headHash: v.union(v.string(), v.null()),
    eventCount: v.number(),
    sealedAt: v.number(),
  })
    .index('by_chain_id_and_sealed_at', ['chainId', 'sealedAt'])
    .index('by_chain_id_and_end_sequence', ['chainId', 'endSequence']),

  auditLedgerImmutableExports: defineTable({
    chainId: v.string(),
    startSequence: v.number(),
    endSequence: v.number(),
    headHash: v.union(v.string(), v.null()),
    eventCount: v.number(),
    sealedAt: v.number(),
    exportedAt: v.number(),
    bucket: v.string(),
    objectKey: v.string(),
    manifestObjectKey: v.string(),
    payloadSha256: v.string(),
    manifestSha256: v.string(),
  })
    .index('by_chain_id_and_exported_at', ['chainId', 'exportedAt'])
    .index('by_chain_id_and_end_sequence', ['chainId', 'endSequence']),

  auditLedgerArchiveVerifications: defineTable({
    chainId: v.string(),
    checkedAt: v.number(),
    required: v.boolean(),
    configured: v.boolean(),
    exporterEnabled: v.boolean(),
    latestSealEndSequence: v.union(v.number(), v.null()),
    latestExportEndSequence: v.union(v.number(), v.null()),
    lagCount: v.number(),
    driftDetected: v.boolean(),
    lastVerificationStatus: v.union(
      v.literal('verified'),
      v.literal('missing_object'),
      v.literal('hash_mismatch'),
      v.literal('no_seal'),
      v.literal('disabled'),
    ),
    lastVerifiedSealEndSequence: v.union(v.number(), v.null()),
    latestManifestObjectKey: v.union(v.string(), v.null()),
    latestPayloadObjectKey: v.union(v.string(), v.null()),
    payloadSha256: v.union(v.string(), v.null()),
    manifestSha256: v.union(v.string(), v.null()),
    failureReason: v.union(v.string(), v.null()),
  })
    .index('by_chain_id_and_checked_at', ['chainId', 'checkedAt'])
    .index('by_chain_id_and_status_and_checked_at', [
      'chainId',
      'lastVerificationStatus',
      'checkedAt',
    ]),

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
    supportAccessApprovalModel: v.literal('single_owner'),
    supportAccessEnabled: v.boolean(),
    webSearchAllowed: v.boolean(),
    aiChatEnabled: v.boolean(),
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

  organizationSupportAccessGrants: defineTable({
    organizationId: v.string(),
    siteAdminUserId: v.string(),
    scope: v.union(v.literal('read_only'), v.literal('read_write')),
    approvalMethod: v.literal('single_owner'),
    approvedAt: v.number(),
    ticketId: v.string(),
    reason: v.string(),
    reasonCategory: v.union(
      v.literal('incident_response'),
      v.literal('customer_requested_change'),
      v.literal('data_repair'),
      v.literal('account_recovery'),
      v.literal('other'),
    ),
    reasonDetails: v.string(),
    grantedByUserId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    firstUsedAt: v.union(v.number(), v.null()),
    lastUsedAt: v.union(v.number(), v.null()),
    useCount: v.number(),
    expiredNotificationSentAt: v.union(v.number(), v.null()),
    revokedAt: v.union(v.number(), v.null()),
    revokedByUserId: v.union(v.string(), v.null()),
    revocationReason: v.union(v.string(), v.null()),
  })
    .index('by_organization_id', ['organizationId'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_organization_id_and_site_admin_user_id', ['organizationId', 'siteAdminUserId'])
    .index('by_expired_notification_sent_at', ['expiredNotificationSentAt']),

  organizationLegalHolds: defineTable({
    organizationId: v.string(),
    status: organizationLegalHoldStatusValidator,
    reason: v.string(),
    openedAt: v.number(),
    openedByUserId: v.string(),
    releasedAt: v.optional(v.number()),
    releasedByUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organization_id', ['organizationId'])
    .index('by_organization_id_and_status', ['organizationId', 'status'])
    .index('by_status_and_opened_at', ['status', 'openedAt']),

  organizationCleanupRequests: defineTable({
    organizationId: v.string(),
    requestedByUserId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    completedAt: v.union(v.number(), v.null()),
  })
    .index('by_organization_id', ['organizationId'])
    .index('by_requested_by_user_id', ['requestedByUserId'])
    .index('by_expires_at', ['expiresAt']),

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
    summary: v.optional(v.union(v.string(), v.null())),
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
    .index('by_purgeEligibleAt', ['purgeEligibleAt'])
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
    extractedTextStorageId: v.optional(v.string()),
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

  pdfParseJobs: defineTable({
    storageId: v.string(),
    organizationId: v.string(),
    requestedByUserId: v.string(),
    status: pdfParseJobStatusValidator,
    errorMessage: v.optional(v.string()),
    dispatchAttempts: v.optional(v.number()),
    dispatchErrorMessage: v.optional(v.string()),
    parserVersion: v.optional(v.string()),
    processingStartedAt: v.optional(v.number()),
    resultStorageId: v.optional(v.string()),
    purgeEligibleAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_storageId', ['storageId'])
    .index('by_purgeEligibleAt', ['purgeEligibleAt'])
    .index('by_status_and_updatedAt', ['status', 'updatedAt'])
    .index('by_requestedByUserId_and_createdAt', ['requestedByUserId', 'createdAt']),

  storageLifecycle: defineTable({
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    storageId: v.string(),
    parentStorageId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    sourceType: v.string(),
    sourceId: v.string(),
    backendMode: storageBackendModeValidator,
    originalFileName: v.string(),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    canonicalBucket: v.optional(v.string()),
    canonicalKey: v.optional(v.string()),
    canonicalVersionId: v.optional(v.string()),
    quarantineBucket: v.optional(v.string()),
    quarantineKey: v.optional(v.string()),
    quarantineVersionId: v.optional(v.string()),
    rejectedBucket: v.optional(v.string()),
    rejectedKey: v.optional(v.string()),
    rejectedVersionId: v.optional(v.string()),
    mirrorBucket: v.optional(v.string()),
    mirrorKey: v.optional(v.string()),
    mirrorVersionId: v.optional(v.string()),
    inspectionStatus: v.optional(storageLifecycleInspectionStatusValidator),
    inspectionReason: v.optional(storageLifecycleInspectionReasonValidator),
    inspectionEngine: v.optional(v.string()),
    inspectionScannedAt: v.optional(v.number()),
    inspectionDetails: v.optional(v.string()),
    malwareStatus: v.optional(storageLifecycleMalwareStatusValidator),
    mirrorStatus: v.optional(storageLifecycleMirrorStatusValidator),
    mirrorAttempts: v.optional(v.number()),
    mirrorLastError: v.optional(v.string()),
    mirrorDeadlineAt: v.optional(v.number()),
    malwareFindingId: v.optional(v.string()),
    malwareScannedAt: v.optional(v.number()),
    malwareDetectedAt: v.optional(v.number()),
    sha256Hex: v.optional(v.string()),
    quarantinedAt: v.optional(v.number()),
    quarantineReason: v.optional(storageLifecycleQuarantineReasonValidator),
    storagePlacement: v.optional(storageLifecyclePlacementValidator),
    uploadedById: v.optional(v.id('users')),
  })
    .index('by_storageId', ['storageId'])
    .index('by_parentStorageId', ['parentStorageId'])
    .index('by_organizationId', ['organizationId'])
    .index('by_source', ['sourceType', 'sourceId'])
    .index('by_backendMode_and_createdAt', ['backendMode', 'createdAt'])
    .index('by_s3Key', ['canonicalBucket', 'canonicalKey'])
    .index('by_mirrorS3Key', ['mirrorBucket', 'mirrorKey'])
    .index('by_quarantineS3Key', ['quarantineBucket', 'quarantineKey'])
    .index('by_rejectedS3Key', ['rejectedBucket', 'rejectedKey'])
    .index('by_mirrorDeadlineAt', ['mirrorDeadlineAt'])
    .index('by_malwareStatus', ['malwareStatus'])
    .index('by_inspectionStatus', ['inspectionStatus'])
    .index('by_deletedAt', ['deletedAt']),

  fileAccessTickets: defineTable({
    ticketId: v.string(),
    storageId: v.string(),
    organizationId: v.union(v.string(), v.null()),
    issuedToUserId: v.string(),
    issuedFromSessionId: v.union(v.string(), v.null()),
    purpose: v.string(),
    sourceSurface: v.string(),
    expiresAt: v.number(),
    redeemedAt: v.optional(v.number()),
    createdAt: v.number(),
    ipAddress: v.union(v.string(), v.null()),
    userAgent: v.union(v.string(), v.null()),
  })
    .index('by_ticketId', ['ticketId'])
    .index('by_storageId_and_createdAt', ['storageId', 'createdAt'])
    .index('by_expiresAt', ['expiresAt']),

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

  authStepUpClaims: defineTable({
    authUserId: v.string(),
    claimId: v.string(),
    consumedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    expiresAt: v.number(),
    method: v.union(
      v.literal('passkey'),
      v.literal('password_only'),
      v.literal('password_plus_totp'),
      v.literal('totp'),
    ),
    requirement: v.union(
      v.literal('account_email_change'),
      v.literal('audit_export'),
      v.literal('attachment_access'),
      v.literal('document_export'),
      v.literal('document_deletion'),
      v.literal('model_catalog_admin'),
      v.literal('organization_admin'),
      v.literal('password_change'),
      v.literal('session_administration'),
      v.literal('support_access_approval'),
      v.literal('user_administration'),
    ),
    resourceId: v.union(v.string(), v.null()),
    resourceType: v.union(v.string(), v.null()),
    sessionId: v.string(),
    updatedAt: v.number(),
    verifiedAt: v.number(),
  })
    .index('by_auth_user_id', ['authUserId'])
    .index('by_auth_user_id_and_session_id_and_requirement', [
      'authUserId',
      'sessionId',
      'requirement',
    ])
    .index('by_claim_id', ['claimId']),

  authStepUpChallenges: defineTable({
    authUserId: v.string(),
    challengeId: v.string(),
    consumedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    expiresAt: v.number(),
    failureReason: v.union(v.string(), v.null()),
    preparedAt: v.union(v.number(), v.null()),
    redirectTo: v.string(),
    requirement: v.union(
      v.literal('account_email_change'),
      v.literal('audit_export'),
      v.literal('attachment_access'),
      v.literal('document_export'),
      v.literal('document_deletion'),
      v.literal('model_catalog_admin'),
      v.literal('organization_admin'),
      v.literal('password_change'),
      v.literal('session_administration'),
      v.literal('support_access_approval'),
      v.literal('user_administration'),
    ),
    sessionId: v.string(),
    updatedAt: v.number(),
  })
    .index('by_challenge_id', ['challengeId'])
    .index('by_auth_user_id_and_session_id', ['authUserId', 'sessionId']),

  authLockoutAttempts: defineTable({
    email: v.string(),
    attempts: v.array(v.number()),
    updatedAt: v.number(),
  }).index('by_email', ['email']),

  passwordHistory: defineTable({
    authUserId: v.string(),
    passwordHash: v.string(),
    createdAt: v.number(),
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
      v.literal('audit_archive_health'),
      v.literal('audit_request_context_gaps'),
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
    reviewStatus: v.union(
      v.literal('pending'),
      v.literal('reviewed'),
      v.literal('needs_follow_up'),
    ),
    reviewedAt: v.union(v.number(), v.null()),
    reviewedByUserId: v.union(v.string(), v.null()),
    customerSummary: v.optional(v.union(v.string(), v.null())),
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
    payloadHash: v.string(),
    exportedAt: v.number(),
    createdAt: v.number(),
    schemaVersion: v.string(),
  })
    .index('by_artifact_type_and_created_at', ['artifactType', 'createdAt'])
    .index('by_created_at', ['createdAt'])
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
    .index('by_source_report_id_and_created_at', ['sourceReportId', 'createdAt']),

  securityControlChecklistItems: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    internalControlId: v.string(),
    itemId: v.string(),
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
      v.literal('review_attestation'),
      v.literal('review_document'),
      v.literal('automated_review_result'),
      v.literal('follow_up_resolution'),
      v.literal('exception_record'),
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
        v.literal('review_attestation'),
        v.literal('review_document'),
        v.literal('automated_review_result'),
        v.literal('follow_up_resolution'),
        v.literal('review_exception'),
      ),
    ),
    reviewOriginReviewRunId: v.optional(v.id('reviewRuns')),
    reviewOriginReviewTaskId: v.optional(v.id('reviewTasks')),
    reviewOriginReviewTaskResultId: v.optional(v.id('reviewTaskResults')),
    reviewOriginReviewAttestationId: v.optional(v.id('reviewAttestations')),
    reviewOriginSourceType: v.optional(
      v.union(
        v.literal('security_control_evidence'),
        v.literal('evidence_report'),
        v.literal('security_finding'),
        v.literal('follow_up_action'),
        v.literal('backup_verification_report'),
        v.literal('external_document'),
        v.literal('review_task'),
        v.literal('vendor'),
      ),
    ),
    reviewOriginSourceId: v.optional(v.string()),
    reviewOriginSourceLabel: v.optional(v.string()),
    validUntil: v.optional(v.number()),
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
    .index('by_internal_control_id_and_item_id', ['internalControlId', 'itemId'])
    .index('by_review_origin_review_task_id', ['reviewOriginReviewTaskId'])
    .index('by_review_origin_source_type_and_source_id', [
      'reviewOriginSourceType',
      'reviewOriginSourceId',
    ]),

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

  securityPolicies: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    policyId: v.string(),
    title: v.string(),
    summary: v.string(),
    customerSummary: v.optional(v.union(v.string(), v.null())),
    internalNotes: v.optional(v.union(v.string(), v.null())),
    owner: v.string(),
    sourcePath: v.string(),
    contentHash: v.string(),
    lastReviewedAt: v.optional(v.number()),
    nextReviewAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_policy_id', ['policyId'])
    .index('by_updated_at', ['updatedAt']),

  securityPolicyControlMappings: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    policyId: v.string(),
    internalControlId: v.string(),
    isPrimary: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_policy_id', ['policyId'])
    .index('by_internal_control_id', ['internalControlId'])
    .index('by_policy_id_and_internal_control_id', ['policyId', 'internalControlId']),

  securityVendors: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    vendorKey: v.union(
      v.literal('openrouter'),
      v.literal('resend'),
      v.literal('sentry'),
      v.literal('google_favicons'),
      v.literal('google_workspace_oauth'),
    ),
    title: v.string(),
    owner: v.optional(v.string()),
    summary: v.optional(v.union(v.string(), v.null())),
    contractStatus: v.optional(
      v.union(
        v.literal('baa_executed'),
        v.literal('dpa_executed'),
        v.literal('not_required'),
        v.literal('pending'),
        v.literal('not_started'),
      ),
    ),
    contractNotes: v.optional(v.union(v.string(), v.null())),
    contractReviewedAt: v.optional(v.union(v.number(), v.null())),
    lastReviewedAt: v.optional(v.union(v.number(), v.null())),
    nextReviewAt: v.optional(v.union(v.number(), v.null())),
    linkedFollowUpRunId: v.optional(v.id('reviewRuns')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_vendor_key', ['vendorKey'])
    .index('by_next_review_at', ['nextReviewAt']),

  securityVendorControlMappings: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    vendorKey: v.union(
      v.literal('openrouter'),
      v.literal('resend'),
      v.literal('sentry'),
      v.literal('google_favicons'),
      v.literal('google_workspace_oauth'),
    ),
    internalControlId: v.string(),
    createdAt: v.number(),
  })
    .index('by_vendor_key', ['vendorKey'])
    .index('by_internal_control_id', ['internalControlId']),

  followUpActions: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    findingId: v.id('securityFindings'),
    findingKey: v.string(),
    reviewRunId: v.optional(v.id('reviewRuns')),
    reviewTaskId: v.optional(v.id('reviewTasks')),
    title: v.string(),
    summary: v.optional(v.string()),
    assigneeUserId: v.optional(v.union(v.string(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
    status: v.union(
      v.literal('open'),
      v.literal('in_progress'),
      v.literal('blocked'),
      v.literal('resolved'),
    ),
    controlLinks: v.array(
      v.object({
        internalControlId: v.string(),
        itemId: v.string(),
      }),
    ),
    latestNote: v.optional(v.union(v.string(), v.null())),
    resolutionNote: v.optional(v.union(v.string(), v.null())),
    openedAt: v.number(),
    openedByUserId: v.string(),
    updatedAt: v.number(),
    updatedByUserId: v.string(),
    resolvedAt: v.optional(v.union(v.number(), v.null())),
    resolvedByUserId: v.optional(v.union(v.string(), v.null())),
  })
    .index('by_finding_key_and_opened_at', ['findingKey', 'openedAt'])
    .index('by_finding_id_and_opened_at', ['findingId', 'openedAt'])
    .index('by_status_and_updated_at', ['status', 'updatedAt'])
    .index('by_review_run_id', ['reviewRunId']),

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
    policyId: v.optional(v.string()),
    vendorKey: v.optional(
      v.union(
        v.literal('openrouter'),
        v.literal('resend'),
        v.literal('sentry'),
        v.literal('google_favicons'),
        v.literal('google_workspace_oauth'),
      ),
    ),
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
      v.literal('vendor'),
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

  securityRelationships: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    fromType: v.union(
      v.literal('control'),
      v.literal('checklist_item'),
      v.literal('evidence'),
      v.literal('finding'),
      v.literal('vendor'),
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
      v.literal('vendor'),
      v.literal('review_run'),
      v.literal('review_task'),
      v.literal('evidence_report'),
    ),
    toId: v.string(),
    relationshipType: v.union(
      v.literal('has_evidence'),
      v.literal('tracks_finding'),
      v.literal('tracks_vendor'),
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

  retentionJobs: defineTable({
    scopeType: v.optional(v.literal('provider_global')),
    scopeId: v.optional(v.string()),
    jobKind: v.union(
      v.literal('attachment_purge'),
      v.literal('quarantine_cleanup'),
      retentionDeletionJobKindValidator,
    ),
    status: v.union(v.literal('success'), v.literal('failure')),
    details: v.optional(v.string()),
    processedCount: v.number(),
    createdAt: v.number(),
  })
    .index('by_job_kind_and_created_at', ['jobKind', 'createdAt'])
    .index('by_created_at', ['createdAt']),

  retentionDeletionBatches: defineTable({
    organizationId: v.string(),
    jobKind: retentionDeletionJobKindValidator,
    policySnapshotJson: v.string(),
    startedAt: v.number(),
    completedAt: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
    deletedCount: v.number(),
    skippedOnHoldCount: v.number(),
    failedCount: v.number(),
    detailsJson: v.string(),
    createdAt: v.number(),
  })
    .index('by_organization_id_and_created_at', ['organizationId', 'createdAt'])
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
