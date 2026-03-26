import { v } from 'convex/values';
import {
  organizationEnterpriseSatisfactionPathValidator,
  organizationEnterpriseAccessStatusValidator,
  organizationSupportAccessScopeValidator,
} from './enterpriseAccess';
import { organizationPermissionValidator } from './organizationPermissions';

export { organizationPermissionValidator } from './organizationPermissions';

export const userRoleValidator = v.union(v.literal('user'), v.literal('admin'));
export const organizationRoleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
);
export const organizationMemberStatusValidator = v.union(
  v.literal('active'),
  v.literal('suspended'),
  v.literal('deactivated'),
);
export const organizationInvitePolicyValidator = v.union(
  v.literal('owners_admins'),
  v.literal('owners_only'),
);
export const organizationViewerRoleValidator = v.union(
  organizationRoleValidator,
  v.literal('site-admin'),
  v.null(),
);
export const organizationAccessValidator = v.object({
  admin: v.boolean(),
  delete: v.boolean(),
  edit: v.boolean(),
  view: v.boolean(),
  siteAdmin: v.boolean(),
});
export const organizationCreationEligibilityValidator = v.object({
  count: v.number(),
  limit: v.union(v.number(), v.null()),
  canCreate: v.boolean(),
  reason: v.union(v.string(), v.null()),
  isUnlimited: v.boolean(),
});
export const onboardingStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('email_pending'),
  v.literal('email_sent'),
  v.literal('delivered'),
  v.literal('delivery_delayed'),
  v.literal('bounced'),
  v.literal('completed'),
);
export const chatAttachmentKindValidator = v.union(v.literal('image'), v.literal('document'));
export const chatAttachmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('pending_scan'),
  v.literal('processing'),
  v.literal('quarantined'),
  v.literal('ready'),
  v.literal('error'),
  v.literal('rejected'),
);
export const chatRunStatusValidator = v.union(
  v.literal('idle'),
  v.literal('streaming'),
  v.literal('complete'),
  v.literal('aborted'),
  v.literal('error'),
);
export const chatRunFailureKindValidator = v.union(
  v.literal('provider_policy'),
  v.literal('provider_unavailable'),
  v.literal('tool_error'),
  v.literal('unknown'),
);
export const chatThreadVisibilityValidator = v.union(v.literal('private'), v.literal('shared'));
export const chatUsageOperationKindValidator = v.union(
  v.literal('chat_turn'),
  v.literal('web_search'),
  v.literal('thread_title'),
  v.literal('thread_summary'),
);
export const chatModelAccessValidator = v.union(v.literal('public'), v.literal('admin'));

export const successValidator = v.object({
  success: v.boolean(),
});
export const successTrueValidator = v.object({
  success: v.boolean(),
});
export const allowedResultValidator = v.union(
  v.object({
    allowed: v.literal(true),
  }),
  v.object({
    allowed: v.literal(false),
    reason: v.string(),
  }),
);
export const rateLimitResultValidator = v.object({
  ok: v.boolean(),
  retryAfter: v.optional(v.number()),
});
export const advisoryChatRateLimitValidator = v.object({
  request: rateLimitResultValidator,
  estimatedTokens: rateLimitResultValidator,
  estimatedInputTokens: v.number(),
});

export const authUserValidator = v.object({
  _id: v.optional(v.string()),
  _creationTime: v.optional(v.number()),
  id: v.optional(v.string()),
  name: v.optional(v.union(v.string(), v.null())),
  email: v.optional(v.union(v.string(), v.null())),
  emailVerified: v.optional(v.boolean()),
  image: v.optional(v.union(v.string(), v.null())),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  twoFactorEnabled: v.optional(v.union(v.boolean(), v.null())),
  isAnonymous: v.optional(v.union(v.boolean(), v.null())),
  username: v.optional(v.union(v.string(), v.null())),
  displayUsername: v.optional(v.union(v.string(), v.null())),
  phoneNumber: v.optional(v.union(v.string(), v.null())),
  phoneNumberVerified: v.optional(v.union(v.boolean(), v.null())),
  userId: v.optional(v.union(v.string(), v.null())),
  role: v.optional(v.union(v.string(), v.array(v.string()), v.null())),
  banned: v.optional(v.union(v.boolean(), v.null())),
  banReason: v.optional(v.union(v.string(), v.null())),
  banExpires: v.optional(v.union(v.number(), v.null())),
});

export const authSessionValidator = v.object({
  _id: v.optional(v.string()),
  _creationTime: v.optional(v.number()),
  id: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  token: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  ipAddress: v.optional(v.union(v.string(), v.null())),
  userAgent: v.optional(v.union(v.string(), v.null())),
  userId: v.optional(v.string()),
  impersonatedBy: v.optional(v.union(v.string(), v.null())),
  activeOrganizationId: v.optional(v.union(v.string(), v.null())),
  authMethod: v.optional(v.union(v.string(), v.null())),
  mfaVerified: v.optional(v.union(v.boolean(), v.null())),
  enterpriseOrganizationId: v.optional(v.union(v.string(), v.null())),
  enterpriseProviderKey: v.optional(v.union(v.string(), v.null())),
  enterpriseProtocol: v.optional(v.union(v.string(), v.null())),
});

export const publicAuthSessionValidator = v.object({
  id: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  impersonatedBy: v.optional(v.union(v.string(), v.null())),
  activeOrganizationId: v.optional(v.union(v.string(), v.null())),
  authMethod: v.optional(v.union(v.string(), v.null())),
  mfaVerified: v.optional(v.union(v.boolean(), v.null())),
  enterpriseOrganizationId: v.optional(v.union(v.string(), v.null())),
  enterpriseProviderKey: v.optional(v.union(v.string(), v.null())),
  enterpriseProtocol: v.optional(v.union(v.string(), v.null())),
});

export const betterAuthMemberValidator = v.object({
  _id: v.optional(v.string()),
  _creationTime: v.optional(v.number()),
  id: v.optional(v.string()),
  organizationId: v.string(),
  userId: v.string(),
  role: v.string(),
  createdAt: v.number(),
});

export const usersDocValidator = v.object({
  _id: v.id('users'),
  _creationTime: v.number(),
  authUserId: v.string(),
  lastActiveOrganizationId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const userProfilesDocValidator = v.object({
  _id: v.id('userProfiles'),
  _creationTime: v.number(),
  authUserId: v.string(),
  email: v.string(),
  emailLower: v.string(),
  name: v.union(v.string(), v.null()),
  nameLower: v.union(v.string(), v.null()),
  phoneNumber: v.union(v.string(), v.null()),
  role: userRoleValidator,
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
});

export const userProfileSyncStateDocValidator = v.object({
  _id: v.id('userProfileSyncState'),
  _creationTime: v.number(),
  key: v.string(),
  lastFullSyncAt: v.number(),
  totalUsers: v.number(),
});

export const auditLedgerEventDocValidator = v.object({
  _id: v.id('auditLedgerEvents'),
  _creationTime: v.number(),
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
});

export const auditLedgerCheckpointDocValidator = v.object({
  _id: v.id('auditLedgerCheckpoints'),
  _creationTime: v.number(),
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
});

export const auditLedgerSealDocValidator = v.object({
  _id: v.id('auditLedgerSeals'),
  _creationTime: v.number(),
  chainId: v.string(),
  startSequence: v.number(),
  endSequence: v.number(),
  headHash: v.union(v.string(), v.null()),
  eventCount: v.number(),
  sealedAt: v.number(),
});

export const auditLedgerImmutableExportDocValidator = v.object({
  _id: v.id('auditLedgerImmutableExports'),
  _creationTime: v.number(),
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
});

export const auditLedgerArchiveVerificationDocValidator = v.object({
  _id: v.id('auditLedgerArchiveVerifications'),
  _creationTime: v.number(),
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
});

export const dashboardStatsDocValidator = v.object({
  _id: v.id('dashboardStats'),
  _creationTime: v.number(),
  key: v.string(),
  totalUsers: v.number(),
  activeUsers: v.number(),
  updatedAt: v.number(),
});

export const chatThreadsDocValidator = v.object({
  _id: v.id('chatThreads'),
  _creationTime: v.number(),
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
});

export const chatRunsDocValidator = v.object({
  _id: v.id('chatRuns'),
  _creationTime: v.number(),
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
});

export const chatUsageEventsDocValidator = v.object({
  _id: v.id('chatUsageEvents'),
  _creationTime: v.number(),
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
});

export const chatAttachmentsDocValidator = v.object({
  _id: v.id('chatAttachments'),
  _creationTime: v.number(),
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
});

export const aiPersonasDocValidator = v.object({
  _id: v.id('aiPersonas'),
  _creationTime: v.number(),
  userId: v.string(),
  organizationId: v.string(),
  name: v.string(),
  prompt: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const personaWithAccessValidator = v.object({
  _id: v.id('aiPersonas'),
  _creationTime: v.number(),
  userId: v.string(),
  organizationId: v.string(),
  name: v.string(),
  prompt: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  canManage: v.boolean(),
});

export const aiModelPriceValidator = v.object({
  unit: v.string(),
  price: v.number(),
  currency: v.string(),
});

export const aiModelCatalogEntryValidator = v.object({
  modelId: v.string(),
  label: v.string(),
  description: v.string(),
  task: v.string(),
  access: chatModelAccessValidator,
  supportsWebSearch: v.optional(v.boolean()),
  priceLabel: v.optional(v.string()),
  prices: v.optional(v.array(aiModelPriceValidator)),
  contextWindow: v.optional(v.number()),
  source: v.string(),
  isActive: v.boolean(),
  refreshedAt: v.number(),
  beta: v.optional(v.boolean()),
  deprecated: v.optional(v.boolean()),
  deprecationDate: v.optional(v.string()),
});

export const aiModelCatalogDocValidator = v.object({
  _id: v.id('aiModelCatalog'),
  _creationTime: v.number(),
  modelId: v.string(),
  label: v.string(),
  description: v.string(),
  task: v.string(),
  access: chatModelAccessValidator,
  supportsWebSearch: v.optional(v.boolean()),
  priceLabel: v.optional(v.string()),
  prices: v.optional(v.array(aiModelPriceValidator)),
  contextWindow: v.optional(v.number()),
  source: v.string(),
  isActive: v.boolean(),
  refreshedAt: v.number(),
  beta: v.optional(v.boolean()),
  deprecated: v.optional(v.boolean()),
  deprecationDate: v.optional(v.string()),
});

export const emailLifecycleEventsDocValidator = v.object({
  _id: v.id('emailLifecycleEvents'),
  _creationTime: v.number(),
  messageId: v.string(),
  emailId: v.optional(v.string()),
  authUserId: v.optional(v.string()),
  email: v.string(),
  category: v.literal('onboarding'),
  eventType: v.string(),
  rawPayload: v.string(),
  occurredAt: v.number(),
  createdAt: v.number(),
});

export const currentUserContextValidator = v.object({
  userId: v.id('users'),
  organizationId: v.string(),
  sessionId: v.string(),
  isSiteAdmin: v.boolean(),
  currentUserName: v.string(),
});

export const threadWithAccessValidator = v.object({
  _id: v.id('chatThreads'),
  _creationTime: v.number(),
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
  createdAt: v.number(),
  updatedAt: v.number(),
  lastMessageAt: v.number(),
  canManage: v.boolean(),
});

export const activeRunWithAccessValidator = v.object({
  _id: v.id('chatRuns'),
  _creationTime: v.number(),
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
  canStop: v.boolean(),
});

export const chatLatestRunStateValidator = v.object({
  runId: v.id('chatRuns'),
  status: chatRunStatusValidator,
  canStop: v.boolean(),
  errorMessage: v.optional(v.string()),
  failureKind: v.optional(chatRunFailureKindValidator),
  endedAt: v.optional(v.number()),
  promptMessageId: v.optional(v.string()),
});

export const chatAttachmentWithPreviewValidator = v.object({
  _id: v.id('chatAttachments'),
  _creationTime: v.number(),
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
  previewUrl: v.union(v.string(), v.null()),
});

export const chatMessagePageValidator = v.object({
  page: v.array(v.any()),
  isDone: v.boolean(),
  continueCursor: v.string(),
  streams: v.optional(v.any()),
});

export const organizationSummaryValidator = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  logo: v.union(v.string(), v.null()),
});

export const directoryOrganizationValidator = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  logo: v.union(v.string(), v.null()),
  viewerRole: organizationViewerRoleValidator,
  canManage: v.boolean(),
  isSiteAdminView: v.boolean(),
});

export const organizationEnterpriseAuthModeValidator = v.union(
  v.literal('off'),
  v.literal('optional'),
  v.literal('required'),
);

export const organizationEnterpriseProviderKeyValidator = v.union(
  v.literal('google-workspace'),
  v.literal('entra'),
  v.literal('okta'),
);

export const organizationEnterpriseAuthProtocolValidator = v.literal('oidc');

export const organizationEnterpriseProviderStatusValidator = v.union(
  v.literal('active'),
  v.literal('not_configured'),
  v.literal('coming_soon'),
);

export const organizationEnterpriseProviderOptionValidator = v.object({
  key: organizationEnterpriseProviderKeyValidator,
  label: v.string(),
  protocol: organizationEnterpriseAuthProtocolValidator,
  status: organizationEnterpriseProviderStatusValidator,
  selectable: v.boolean(),
});

export const organizationEnterpriseAuthSummaryValidator = v.union(
  v.null(),
  v.object({
    providerKey: organizationEnterpriseProviderKeyValidator,
    providerLabel: v.string(),
    protocol: organizationEnterpriseAuthProtocolValidator,
    providerStatus: organizationEnterpriseProviderStatusValidator,
    managedDomains: v.array(v.string()),
    scimProviderId: v.string(),
    scimConnectionConfigured: v.boolean(),
  }),
);

export const organizationSettingsValidator = v.object({
  organization: organizationSummaryValidator,
  access: organizationAccessValidator,
  policies: v.object({
    invitePolicy: organizationInvitePolicyValidator,
    verifiedDomainsOnly: v.boolean(),
    memberCap: v.union(v.number(), v.null()),
    mfaRequired: v.boolean(),
    auditExportRequiresStepUp: v.boolean(),
    attachmentSharingAllowed: v.boolean(),
    dataRetentionDays: v.number(),
    enterpriseAuthMode: organizationEnterpriseAuthModeValidator,
    enterpriseProviderKey: v.union(organizationEnterpriseProviderKeyValidator, v.null()),
    enterpriseProtocol: v.union(organizationEnterpriseAuthProtocolValidator, v.null()),
    enterpriseEnabledAt: v.union(v.number(), v.null()),
    enterpriseEnforcedAt: v.union(v.number(), v.null()),
    allowBreakGlassPasswordLogin: v.boolean(),
    temporaryLinkTtlMinutes: v.number(),
    webSearchAllowed: v.boolean(),
  }),
  enterpriseAuth: organizationEnterpriseAuthSummaryValidator,
  availableEnterpriseProviders: v.array(organizationEnterpriseProviderOptionValidator),
  capabilities: v.object({
    availableInviteRoles: v.array(organizationRoleValidator),
    canInvite: v.boolean(),
    canUpdateSettings: v.boolean(),
    canDeleteOrganization: v.boolean(),
    canLeaveOrganization: v.boolean(),
    canManageMembers: v.boolean(),
    canManageDomains: v.boolean(),
    canViewAudit: v.boolean(),
    canManagePolicies: v.boolean(),
  }),
  isMember: v.boolean(),
  viewerRole: organizationViewerRoleValidator,
  canManage: v.boolean(),
});

export const organizationMemberRowValidator = v.object({
  id: v.string(),
  kind: v.literal('member'),
  membershipId: v.string(),
  authUserId: v.string(),
  name: v.union(v.string(), v.null()),
  email: v.string(),
  role: organizationRoleValidator,
  status: organizationMemberStatusValidator,
  createdAt: v.number(),
  isSiteAdmin: v.boolean(),
  availableRoles: v.array(organizationRoleValidator),
  canChangeRole: v.boolean(),
  canRemove: v.boolean(),
  canSuspend: v.boolean(),
  canDeactivate: v.boolean(),
  canReactivate: v.boolean(),
});

export const organizationInvitationRowValidator = v.object({
  id: v.string(),
  kind: v.literal('invite'),
  invitationId: v.string(),
  name: v.null(),
  email: v.string(),
  role: organizationRoleValidator,
  status: v.union(v.literal('pending'), v.literal('expired')),
  createdAt: v.number(),
  expiresAt: v.number(),
  canRevoke: v.boolean(),
});

export const organizationDirectoryRowValidator = v.union(
  organizationMemberRowValidator,
  organizationInvitationRowValidator,
);

export const organizationDirectoryResponseValidator = v.object({
  organization: organizationSummaryValidator,
  access: organizationAccessValidator,
  policies: v.object({
    invitePolicy: organizationInvitePolicyValidator,
    verifiedDomainsOnly: v.boolean(),
    memberCap: v.union(v.number(), v.null()),
    mfaRequired: v.boolean(),
    auditExportRequiresStepUp: v.boolean(),
    attachmentSharingAllowed: v.boolean(),
    dataRetentionDays: v.number(),
    enterpriseAuthMode: organizationEnterpriseAuthModeValidator,
    enterpriseProviderKey: v.union(organizationEnterpriseProviderKeyValidator, v.null()),
    enterpriseProtocol: v.union(organizationEnterpriseAuthProtocolValidator, v.null()),
    enterpriseEnabledAt: v.union(v.number(), v.null()),
    enterpriseEnforcedAt: v.union(v.number(), v.null()),
    allowBreakGlassPasswordLogin: v.boolean(),
    temporaryLinkTtlMinutes: v.number(),
    webSearchAllowed: v.boolean(),
  }),
  capabilities: v.object({
    availableInviteRoles: v.array(organizationRoleValidator),
    canInvite: v.boolean(),
    canUpdateSettings: v.boolean(),
    canDeleteOrganization: v.boolean(),
    canLeaveOrganization: v.boolean(),
    canManageMembers: v.boolean(),
    canManageDomains: v.boolean(),
    canViewAudit: v.boolean(),
    canManagePolicies: v.boolean(),
  }),
  viewerRole: organizationViewerRoleValidator,
  rows: v.array(organizationDirectoryRowValidator),
  counts: v.object({
    members: v.number(),
    invites: v.number(),
  }),
  pagination: v.object({
    page: v.number(),
    pageSize: v.number(),
    total: v.number(),
    totalPages: v.number(),
  }),
});

export const organizationDomainStatusValidator = v.union(
  v.literal('pending_verification'),
  v.literal('verified'),
);

export const organizationDomainDocValidator = v.object({
  _id: v.id('organizationDomains'),
  _creationTime: v.number(),
  organizationId: v.string(),
  domain: v.string(),
  normalizedDomain: v.string(),
  status: organizationDomainStatusValidator,
  verificationMethod: v.literal('dns_txt'),
  verificationToken: v.string(),
  verifiedAt: v.union(v.number(), v.null()),
  createdByUserId: v.string(),
  createdAt: v.number(),
});

export const organizationDomainValidator = v.object({
  id: v.id('organizationDomains'),
  organizationId: v.string(),
  domain: v.string(),
  normalizedDomain: v.string(),
  status: organizationDomainStatusValidator,
  verificationMethod: v.literal('dns_txt'),
  verificationToken: v.union(v.string(), v.null()),
  verificationRecordName: v.union(v.string(), v.null()),
  verificationRecordValue: v.union(v.string(), v.null()),
  verifiedAt: v.union(v.number(), v.null()),
  createdByUserId: v.string(),
  createdAt: v.number(),
});

export const organizationDomainsResponseValidator = v.object({
  organization: organizationSummaryValidator,
  enterpriseAuth: organizationEnterpriseAuthSummaryValidator,
  capabilities: v.object({
    canManageDomains: v.boolean(),
    canViewAudit: v.boolean(),
  }),
  domains: v.array(organizationDomainValidator),
});

export const internalOrganizationEnterpriseAuthResolutionResultValidator = v.union(
  v.null(),
  v.object({
    organizationId: v.string(),
    providerKey: organizationEnterpriseProviderKeyValidator,
    providerStatus: organizationEnterpriseProviderStatusValidator,
    protocol: organizationEnterpriseAuthProtocolValidator,
    managedDomain: v.string(),
    requiresEnterpriseAuth: v.boolean(),
    canUsePasswordFallback: v.boolean(),
  }),
);

export const organizationEnterpriseAuthResolutionResultValidator = v.union(
  v.null(),
  v.object({
    providerKey: organizationEnterpriseProviderKeyValidator,
    protocol: organizationEnterpriseAuthProtocolValidator,
    requiresEnterpriseAuth: v.boolean(),
    canUsePasswordFallback: v.boolean(),
  }),
);

export const organizationEnterpriseAccessResultValidator = v.object({
  allowed: v.boolean(),
  status: organizationEnterpriseAccessStatusValidator,
  reason: v.union(v.string(), v.null()),
  requiresEnterpriseAuth: v.boolean(),
  satisfactionPath: v.union(organizationEnterpriseSatisfactionPathValidator, v.null()),
  providerKey: v.union(organizationEnterpriseProviderKeyValidator, v.null()),
  enterpriseAuthMode: organizationEnterpriseAuthModeValidator,
  supportGrant: v.union(
    v.object({
      expiresAt: v.number(),
      id: v.id('organizationSupportAccessGrants'),
      reason: v.string(),
      scope: organizationSupportAccessScopeValidator,
      ticketId: v.string(),
    }),
    v.null(),
  ),
});

export const organizationDomainVerificationResultValidator = v.object({
  verified: v.boolean(),
  checkedAt: v.number(),
  domain: organizationDomainValidator,
  reason: v.union(v.string(), v.null()),
});

export const organizationAuditEventViewModelValidator = v.object({
  id: v.string(),
  eventType: v.string(),
  label: v.string(),
  actorLabel: v.optional(v.string()),
  targetLabel: v.optional(v.string()),
  summary: v.optional(v.string()),
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
  eventHash: v.optional(v.string()),
  previousEventHash: v.optional(v.string()),
  createdAt: v.number(),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

export const organizationAuditResponseValidator = v.object({
  organization: organizationSummaryValidator,
  capabilities: v.object({
    canViewAudit: v.boolean(),
  }),
  events: v.array(organizationAuditEventViewModelValidator),
  pagination: v.object({
    page: v.number(),
    pageSize: v.number(),
    total: v.number(),
    totalPages: v.number(),
  }),
});

export const currentUserOrganizationSummaryValidator = v.object({
  id: v.string(),
  name: v.string(),
  role: v.string(),
});

export const stepUpMethodValidator = v.union(
  v.literal('passkey'),
  v.literal('password_only'),
  v.literal('password_plus_totp'),
  v.literal('totp'),
);

export const stepUpRequirementValidator = v.union(
  v.literal('account_email_change'),
  v.literal('audit_export'),
  v.literal('attachment_access'),
  v.literal('document_export'),
  v.literal('document_deletion'),
  v.literal('organization_admin'),
  v.literal('password_change'),
  v.literal('session_administration'),
  v.literal('support_access_approval'),
  v.literal('user_administration'),
  v.literal('model_catalog_admin'),
);

export const authStepUpClaimsDocValidator = v.object({
  _id: v.id('authStepUpClaims'),
  _creationTime: v.number(),
  authUserId: v.string(),
  claimId: v.string(),
  consumedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  expiresAt: v.number(),
  method: stepUpMethodValidator,
  requirement: stepUpRequirementValidator,
  resourceId: v.union(v.string(), v.null()),
  resourceType: v.union(v.string(), v.null()),
  sessionId: v.string(),
  updatedAt: v.number(),
  verifiedAt: v.number(),
});

export const authStepUpChallengeDocValidator = v.object({
  _id: v.id('authStepUpChallenges'),
  _creationTime: v.number(),
  authUserId: v.string(),
  challengeId: v.string(),
  consumedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  expiresAt: v.number(),
  failureReason: v.union(v.string(), v.null()),
  preparedAt: v.union(v.number(), v.null()),
  redirectTo: v.string(),
  requirement: stepUpRequirementValidator,
  sessionId: v.string(),
  updatedAt: v.number(),
});

export const stepUpChallengeSummaryValidator = v.object({
  challengeId: v.string(),
  redirectTo: v.string(),
  requirement: stepUpRequirementValidator,
});

export const stepUpChallengeCompletionResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    requirement: stepUpRequirementValidator,
  }),
  v.object({
    ok: v.literal(false),
    reason: v.string(),
    requirement: v.union(stepUpRequirementValidator, v.null()),
  }),
);

export const currentUserProfileValidator = v.object({
  id: v.string(),
  email: v.string(),
  name: v.union(v.string(), v.null()),
  phoneNumber: v.union(v.string(), v.null()),
  role: userRoleValidator,
  isSiteAdmin: v.boolean(),
  emailVerified: v.boolean(),
  requiresEmailVerification: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  mfaEnabled: v.boolean(),
  mfaRequired: v.boolean(),
  requiresMfaSetup: v.boolean(),
  recentStepUpAt: v.union(v.number(), v.null()),
  recentStepUpValidUntil: v.union(v.number(), v.null()),
  currentOrganization: v.union(currentUserOrganizationSummaryValidator, v.null()),
  organizations: v.array(currentUserOrganizationSummaryValidator),
});

export const currentAppUserValidator = v.object({
  _id: v.id('users'),
  _creationTime: v.number(),
  authUserId: v.string(),
  lastActiveOrganizationId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  activeOrganizationId: v.union(v.string(), v.null()),
  authSession: v.union(publicAuthSessionValidator, v.null()),
  authUser: authUserValidator,
  isSiteAdmin: v.boolean(),
});

export const internalCurrentAppUserValidator = v.object({
  _id: v.id('users'),
  _creationTime: v.number(),
  authUserId: v.string(),
  lastActiveOrganizationId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  activeOrganizationId: v.union(v.string(), v.null()),
  authSession: v.union(authSessionValidator, v.null()),
  authUser: authUserValidator,
  isSiteAdmin: v.boolean(),
});

export const organizationPermissionDecisionValidator = v.object({
  assurance: v.object({
    emailVerified: v.boolean(),
    enterpriseSatisfied: v.boolean(),
    enterpriseSatisfactionPath: v.union(organizationEnterpriseSatisfactionPathValidator, v.null()),
    enterpriseStatus: organizationEnterpriseAccessStatusValidator,
    mfaSatisfied: v.boolean(),
    recentStepUpSatisfied: v.boolean(),
    supportGrantId: v.union(v.id('organizationSupportAccessGrants'), v.null()),
    supportGrantScope: v.union(organizationSupportAccessScopeValidator, v.null()),
    supportGrantTicketId: v.union(v.string(), v.null()),
  }),
  membership: v.union(betterAuthMemberValidator, v.null()),
  membershipStatus: v.union(
    v.literal('active'),
    v.literal('deactivated'),
    v.literal('suspended'),
    v.null(),
  ),
  organizationId: v.string(),
  organizationSlug: v.union(v.string(), v.null()),
  permission: organizationPermissionValidator,
  user: currentAppUserValidator,
  viewerRole: organizationViewerRoleValidator,
});

export const organizationSupportAccessGrantRowValidator = v.object({
  id: v.id('organizationSupportAccessGrants'),
  approvalMethod: v.literal('single_owner'),
  approvedAt: v.number(),
  createdAt: v.number(),
  expiresAt: v.number(),
  expiredNotificationSentAt: v.union(v.number(), v.null()),
  firstUsedAt: v.union(v.number(), v.null()),
  grantedByEmail: v.union(v.string(), v.null()),
  grantedByName: v.union(v.string(), v.null()),
  grantedByUserId: v.string(),
  reason: v.string(),
  reasonCategory: v.union(
    v.literal('incident_response'),
    v.literal('customer_requested_change'),
    v.literal('data_repair'),
    v.literal('account_recovery'),
    v.literal('other'),
  ),
  reasonDetails: v.string(),
  lastUsedAt: v.union(v.number(), v.null()),
  revokedAt: v.union(v.number(), v.null()),
  revokedByEmail: v.union(v.string(), v.null()),
  revokedByName: v.union(v.string(), v.null()),
  revocationReason: v.union(v.string(), v.null()),
  revokedByUserId: v.union(v.string(), v.null()),
  scope: organizationSupportAccessScopeValidator,
  siteAdminEmail: v.string(),
  siteAdminName: v.union(v.string(), v.null()),
  siteAdminUserId: v.string(),
  ticketId: v.string(),
  useCount: v.number(),
});

export const organizationSupportAccessSiteAdminOptionValidator = v.object({
  authUserId: v.string(),
  email: v.string(),
  name: v.union(v.string(), v.null()),
});

export const organizationSupportAccessSettingsValidator = v.object({
  approvalModel: v.literal('single_owner'),
  availableSiteAdmins: v.array(organizationSupportAccessSiteAdminOptionValidator),
  canManageSupportAccess: v.boolean(),
  grants: v.array(organizationSupportAccessGrantRowValidator),
  organization: organizationSummaryValidator,
  supportAccessEnabled: v.boolean(),
  stepUpSatisfied: v.boolean(),
  stepUpValidUntil: v.union(v.number(), v.null()),
});

export const organizationLegalHoldStatusValidator = v.union(
  v.literal('active'),
  v.literal('released'),
);

export const organizationLegalHoldSummaryValidator = v.object({
  id: v.id('organizationLegalHolds'),
  openedAt: v.number(),
  openedByUserId: v.string(),
  organizationId: v.string(),
  reason: v.string(),
  releasedAt: v.union(v.number(), v.null()),
  releasedByUserId: v.union(v.string(), v.null()),
  status: organizationLegalHoldStatusValidator,
});

export const retentionDeletionBatchValidator = v.object({
  id: v.id('retentionDeletionBatches'),
  organizationId: v.string(),
  jobKind: v.union(v.literal('temporary_artifact_purge'), v.literal('phi_record_purge')),
  policySnapshotJson: v.string(),
  startedAt: v.number(),
  completedAt: v.number(),
  status: v.union(v.literal('success'), v.literal('failure')),
  deletedCount: v.number(),
  skippedOnHoldCount: v.number(),
  failedCount: v.number(),
  detailsJson: v.string(),
  createdAt: v.number(),
});

export const currentUserSessionValidator = v.object({
  id: v.string(),
  isCurrent: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  ipAddress: v.union(v.string(), v.null()),
  userAgent: v.union(v.string(), v.null()),
});

export const currentUserSessionsValidator = v.array(currentUserSessionValidator);

export const ensureUserContextResultValidator = v.object({
  userId: v.id('users'),
  organizationId: v.string(),
});

export const bootstrapUserContextResultValidator = v.union(
  v.object({
    found: v.literal(false),
  }),
  v.object({
    assignedRole: userRoleValidator,
    found: v.literal(true),
    userId: v.id('users'),
    organizationId: v.string(),
  }),
);

export const userContextRecordsValidator = v.object({
  appUserId: v.union(v.id('users'), v.null()),
  userProfileId: v.union(v.id('userProfiles'), v.null()),
});

export const userCountValidator = v.object({
  totalUsers: v.union(v.number(), v.null()),
  isFirstUser: v.boolean(),
});

export const dashboardDataValidator = v.union(
  v.object({
    status: v.literal('unauthenticated'),
  }),
  v.object({
    status: v.literal('forbidden'),
  }),
  v.object({
    status: v.literal('success'),
    stats: v.object({
      totalUsers: v.number(),
      activeUsers: v.number(),
      recentSignups: v.number(),
      lastUpdated: v.string(),
    }),
  }),
);

export const dashboardCountsValidator = v.object({
  totalUsers: v.number(),
  activeUsers: v.number(),
  updatedAt: v.number(),
});

export const adminOrganizationSummaryValidator = v.object({
  id: v.string(),
  slug: v.string(),
  name: v.string(),
  logo: v.union(v.string(), v.null()),
});

export const adminUserValidator = v.object({
  id: v.string(),
  email: v.string(),
  name: v.union(v.string(), v.null()),
  role: userRoleValidator,
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
  organizations: v.array(adminOrganizationSummaryValidator),
});

export const adminUsersResponseValidator = v.object({
  users: v.array(adminUserValidator),
  pagination: v.object({
    page: v.number(),
    pageSize: v.number(),
    total: v.number(),
    totalPages: v.number(),
    hasNextPage: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
  }),
});

export const chatModelOptionValidator = v.object({
  id: v.string(),
  label: v.string(),
  description: v.string(),
  access: chatModelAccessValidator,
  selectable: v.boolean(),
  supportsWebSearch: v.optional(v.boolean()),
  priceLabel: v.optional(v.string()),
  badge: v.optional(v.string()),
});

export const auditEventValidator = v.object({
  id: v.string(),
  sequence: v.number(),
  eventType: v.string(),
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
  eventHash: v.optional(v.string()),
  previousEventHash: v.optional(v.string()),
  recordedAt: v.number(),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

export const auditLedgerEventsResponseValidator = v.object({
  events: v.array(auditEventValidator),
  limit: v.number(),
  continueCursor: v.union(v.string(), v.null()),
  isDone: v.boolean(),
});

export const auditLedgerExportManifestValidator = v.object({
  chainId: v.string(),
  chainVersion: v.number(),
  firstSequence: v.union(v.number(), v.null()),
  lastSequence: v.union(v.number(), v.null()),
  rowCount: v.number(),
  headHash: v.union(v.string(), v.null()),
  exportedAt: v.number(),
});

export const auditLedgerExportValidator = v.object({
  filename: v.string(),
  jsonl: v.string(),
  manifest: auditLedgerExportManifestValidator,
});

export const auditLedgerIntegrityResultValidator = v.object({
  chainId: v.string(),
  checkedAt: v.number(),
  checkedFromSequence: v.number(),
  checkedToSequence: v.number(),
  headHash: v.union(v.string(), v.null()),
  headSequence: v.number(),
  ok: v.boolean(),
  verifiedEventCount: v.number(),
  failure: v.union(
    v.object({
      actualEventHash: v.union(v.string(), v.null()),
      actualPreviousEventHash: v.union(v.string(), v.null()),
      eventId: v.string(),
      expectedPreviousEventHash: v.union(v.string(), v.null()),
      expectedSequence: v.number(),
      recomputedEventHash: v.string(),
    }),
    v.null(),
  ),
});

export const emailServiceConfiguredValidator = v.object({
  isConfigured: v.boolean(),
  message: v.union(v.string(), v.null()),
});

export const e2eEnsurePrincipalRoleValidator = v.union(
  v.object({
    found: v.literal(false),
  }),
  v.object({
    found: v.literal(true),
    userId: v.string(),
    role: userRoleValidator,
  }),
);

export const e2eResetPrincipalValidator = v.union(
  v.object({
    deleted: v.literal(false),
  }),
  v.object({
    deleted: v.literal(true),
    userId: v.string(),
  }),
);

export const systemStatsValidator = v.object({
  users: v.number(),
  admins: v.number(),
});

export const chatModelCatalogStatusValidator = v.object({
  activeModelsCount: v.number(),
  publicModelsCount: v.number(),
  adminModelsCount: v.number(),
  lastRefreshedAt: v.union(v.number(), v.null()),
});

export const mutationMessageResultValidator = v.object({
  success: v.boolean(),
  message: v.string(),
});

export const createdChatModelResultValidator = v.object({
  success: v.boolean(),
  message: v.string(),
  modelId: v.id('aiModelCatalog'),
});

export const promotedUserResultValidator = v.object({
  success: v.boolean(),
  email: v.string(),
  userId: v.string(),
});

export const importedModelsResultValidator = v.object({
  success: v.boolean(),
  message: v.string(),
});

export const importedModelCountValidator = v.object({
  modelCount: v.number(),
});

export const probeHealthValidator = v.object({
  connected: v.literal(true),
});

export const inviteApiKeyDestroyResultValidator = v.union(
  v.literal('missing'),
  v.literal('deleted'),
  v.literal('name mismatch'),
  v.literal('must provide either apiKey or name'),
);
