import { anyApi } from 'convex/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { getRetentionPolicyConfig } from '../src/lib/server/security-config.server';
import { getVendorBoundarySnapshot } from '../src/lib/server/vendor-boundary.server';
import { ACTIVE_CONTROL_REGISTER } from '../src/lib/shared/compliance/control-register';
import { ALWAYS_ON_REGULATED_BASELINE, REGULATED_ORGANIZATION_POLICY_DEFAULTS } from '../src/lib/shared/security-baseline';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import {
  getVerifiedCurrentSiteAdminUserFromActionOrThrow,
  getVerifiedCurrentSiteAdminUserOrThrow,
} from './auth/access';
import { fetchAllBetterAuthPasskeys, fetchAllBetterAuthUsers } from './lib/betterAuth';

const securityPostureSummaryValidator = v.object({
  audit: v.object({
    integrityFailures: v.number(),
    lastEventAt: v.union(v.number(), v.null()),
  }),
  auth: v.object({
    emailVerificationRequired: v.boolean(),
    mfaCoveragePercent: v.number(),
    mfaEnabledUsers: v.number(),
    passkeyEnabledUsers: v.number(),
    totalUsers: v.number(),
  }),
  backups: v.object({
    lastCheckedAt: v.union(v.number(), v.null()),
    lastStatus: v.union(v.literal('success'), v.literal('failure'), v.null()),
  }),
  retention: v.object({
    lastJobAt: v.union(v.number(), v.null()),
    lastJobStatus: v.union(v.literal('success'), v.literal('failure'), v.null()),
  }),
  scanner: v.object({
    lastScanAt: v.union(v.number(), v.null()),
    quarantinedCount: v.number(),
    rejectedCount: v.number(),
    totalScans: v.number(),
  }),
  sessions: v.object({
    freshWindowMinutes: v.number(),
    sessionExpiryHours: v.number(),
    temporaryLinkTtlMinutes: v.number(),
  }),
  telemetry: v.object({
    sentryApproved: v.boolean(),
    sentryEnabled: v.boolean(),
  }),
  vendors: v.array(
    v.object({
      allowedDataClasses: v.array(v.string()),
      allowedEnvironments: v.array(
        v.union(v.literal('development'), v.literal('production'), v.literal('test')),
      ),
      approvalEnvVar: v.union(v.string(), v.null()),
      approved: v.boolean(),
      approvedByDefault: v.boolean(),
      displayName: v.string(),
      vendor: v.string(),
    }),
  ),
});

const evidenceReportValidator = v.object({
  createdAt: v.number(),
  exportHash: v.union(v.string(), v.null()),
  id: v.id('evidenceReports'),
  report: v.string(),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
});

const evidenceReportRecordValidator = v.object({
  _id: v.id('evidenceReports'),
  _creationTime: v.number(),
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
});

const evidenceReportListItemValidator = v.object({
  id: v.id('evidenceReports'),
  createdAt: v.number(),
  generatedByUserId: v.string(),
  reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
  contentHash: v.string(),
  exportHash: v.union(v.string(), v.null()),
  exportedAt: v.union(v.number(), v.null()),
  exportedByUserId: v.union(v.string(), v.null()),
  reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  reviewedAt: v.union(v.number(), v.null()),
  reviewedByUserId: v.union(v.string(), v.null()),
  reviewNotes: v.union(v.string(), v.null()),
});

const evidenceReportListValidator = v.array(evidenceReportListItemValidator);
const checklistStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('in_progress'),
  v.literal('done'),
  v.literal('not_applicable'),
);
const evidenceSufficiencyValidator = v.union(
  v.literal('missing'),
  v.literal('partial'),
  v.literal('sufficient'),
);
const evidenceTypeValidator = v.union(
  v.literal('file'),
  v.literal('link'),
  v.literal('note'),
  v.literal('system_snapshot'),
);
const suggestedEvidenceTypeValidator = v.union(
  v.literal('file'),
  v.literal('link'),
  v.literal('note'),
  v.literal('system'),
);
const controlEvidenceValidator = v.object({
  createdAt: v.number(),
  description: v.union(v.string(), v.null()),
  evidenceType: evidenceTypeValidator,
  fileName: v.union(v.string(), v.null()),
  id: v.string(),
  mimeType: v.union(v.string(), v.null()),
  reviewedAt: v.union(v.number(), v.null()),
  sizeBytes: v.union(v.number(), v.null()),
  storageId: v.union(v.string(), v.null()),
  sufficiency: evidenceSufficiencyValidator,
  title: v.string(),
  url: v.union(v.string(), v.null()),
});
const controlChecklistItemValidator = v.object({
  completedAt: v.union(v.number(), v.null()),
  description: v.string(),
  evidence: v.array(controlEvidenceValidator),
  evidenceSufficiency: evidenceSufficiencyValidator,
  itemId: v.string(),
  label: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  notes: v.union(v.string(), v.null()),
  owner: v.union(v.string(), v.null()),
  required: v.boolean(),
  status: checklistStatusValidator,
  suggestedEvidenceTypes: v.array(suggestedEvidenceTypeValidator),
  verificationMethod: v.string(),
});
const securityControlWorkspaceValidator = v.object({
  controlStatement: v.string(),
  coverage: v.union(
    v.literal('covered'),
    v.literal('partial'),
    v.literal('not-covered'),
    v.literal('not-applicable'),
  ),
  customerResponsibilityNotes: v.union(v.string(), v.null()),
  evidenceReadiness: v.union(v.literal('ready'), v.literal('partial'), v.literal('missing')),
  familyId: v.string(),
  familyTitle: v.string(),
  implementationSummary: v.string(),
  internalControlId: v.string(),
  lastReviewedAt: v.union(v.number(), v.null()),
  mappings: v.object({
    csf20: v.array(
      v.object({
        label: v.union(v.string(), v.null()),
        subcategoryId: v.string(),
      }),
    ),
    hipaa: v.array(
      v.object({
        citation: v.string(),
        implementationSpecification: v.union(
          v.literal('addressable'),
          v.literal('required'),
          v.null(),
        ),
        title: v.union(v.string(), v.null()),
        type: v.union(
          v.literal('implementation_specification'),
          v.literal('section'),
          v.literal('standard'),
          v.literal('subsection'),
          v.null(),
        ),
      }),
    ),
    nist80066: v.array(
      v.object({
        label: v.union(v.string(), v.null()),
        mappingType: v.union(
          v.literal('key-activity'),
          v.literal('relationship'),
          v.literal('sample-question'),
          v.null(),
        ),
        referenceId: v.string(),
      }),
    ),
    soc2: v.array(
      v.object({
        criterionId: v.string(),
        group: v.union(
          v.literal('availability'),
          v.literal('common-criteria'),
          v.literal('confidentiality'),
          v.literal('privacy'),
          v.literal('processing-integrity'),
        ),
        label: v.union(v.string(), v.null()),
        trustServiceCategory: v.union(
          v.literal('availability'),
          v.literal('confidentiality'),
          v.literal('privacy'),
          v.literal('processing-integrity'),
          v.literal('security'),
        ),
      }),
    ),
  }),
  nist80053Id: v.string(),
  owner: v.string(),
  platformChecklist: v.array(controlChecklistItemValidator),
  platformImplementationStatus: v.union(
    v.literal('covered'),
    v.literal('partial'),
    v.literal('not-covered'),
    v.literal('not-applicable'),
  ),
  priority: v.union(v.literal('p0'), v.literal('p1'), v.literal('p2')),
  responsibility: v.union(
    v.literal('platform'),
    v.literal('shared-responsibility'),
    v.literal('customer'),
    v.null(),
  ),
  title: v.string(),
});
const securityControlWorkspaceListValidator = v.array(securityControlWorkspaceValidator);

function stringifyStable(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function hashContent(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

function deriveItemEvidenceSufficiency(
  evidence: Array<{ sufficiency: 'missing' | 'partial' | 'sufficient' }>,
) {
  if (evidence.some((item) => item.sufficiency === 'sufficient')) {
    return 'sufficient' as const;
  }
  if (evidence.some((item) => item.sufficiency === 'partial')) {
    return 'partial' as const;
  }
  return 'missing' as const;
}

function derivePlatformImplementationStatus(
  items: Array<{ required: boolean; status: 'done' | 'in_progress' | 'not_applicable' | 'not_started' }>,
) {
  const requiredItems = items.filter((item) => item.required);
  if (requiredItems.length === 0) {
    return 'not-applicable' as const;
  }
  const satisfied = requiredItems.filter(
    (item) => item.status === 'done' || item.status === 'not_applicable',
  ).length;
  if (satisfied === requiredItems.length) {
    return 'covered' as const;
  }
  if (satisfied === 0 && requiredItems.every((item) => item.status === 'not_started')) {
    return 'not-covered' as const;
  }
  return 'partial' as const;
}

function deriveEvidenceReadiness(
  items: Array<{
    evidenceSufficiency: 'missing' | 'partial' | 'sufficient';
    required: boolean;
  }>,
) {
  const requiredItems = items.filter((item) => item.required);
  if (requiredItems.length === 0) {
    return 'ready' as const;
  }
  if (requiredItems.every((item) => item.evidenceSufficiency === 'sufficient')) {
    return 'ready' as const;
  }
  if (requiredItems.every((item) => item.evidenceSufficiency === 'missing')) {
    return 'missing' as const;
  }
  return 'partial' as const;
}

const documentScanEventArgs = {
  attachmentId: v.optional(v.id('chatAttachments')),
  details: v.optional(v.union(v.string(), v.null())),
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
  scannedAt: v.number(),
  scannerEngine: v.string(),
};

export const recordDocumentScanEvent = mutation({
  args: documentScanEventArgs,
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('documentScanEvents', {
      ...args,
      createdAt: Date.now(),
      details: args.details ?? null,
    });
  },
});

export const recordDocumentScanEventInternal = internalMutation({
  args: {
    ...documentScanEventArgs,
  },
  returns: v.id('documentScanEvents'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('documentScanEvents', {
      ...args,
      createdAt: Date.now(),
      details: args.details ?? null,
    });
  },
});

export const recordRetentionJob = internalMutation({
  args: {
    details: v.optional(v.string()),
    jobKind: v.union(
      v.literal('attachment_purge'),
      v.literal('quarantine_cleanup'),
      v.literal('audit_export_cleanup'),
    ),
    processedCount: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
  },
  returns: v.id('retentionJobs'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('retentionJobs', {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const recordBackupVerification = internalMutation({
  args: {
    checkedAt: v.number(),
    status: v.union(v.literal('success'), v.literal('failure')),
    summary: v.string(),
  },
  returns: v.id('backupVerificationReports'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('backupVerificationReports', {
      ...args,
      createdAt: Date.now(),
    });
  },
});

async function listSecurityControlWorkspaceRecords(ctx: QueryCtx) {
  const [checklistItems, evidenceRows] = await Promise.all([
    ctx.db.query('securityControlChecklistItems').collect(),
    ctx.db.query('securityControlEvidence').collect(),
  ]);

  const checklistStateByKey = new Map(
    checklistItems.map((item) => [`${item.internalControlId}:${item.itemId}`, item]),
  );
  const evidenceByKey = evidenceRows.reduce<
    Map<string, Array<(typeof evidenceRows)[number]>>
  >((accumulator, evidence) => {
    const key = `${evidence.internalControlId}:${evidence.itemId}`;
    const current = accumulator.get(key) ?? [];
    current.push(evidence);
    accumulator.set(key, current);
    return accumulator;
  }, new Map());
  const seededReviewedAt = Date.parse(ACTIVE_CONTROL_REGISTER.generatedAt);

  return ACTIVE_CONTROL_REGISTER.controls.map((control) => {
    const platformChecklist = control.platformChecklistItems.map((item) => {
      const state = checklistStateByKey.get(`${control.internalControlId}:${item.itemId}`);
      const hiddenSeedEvidenceIds = new Set(state?.hiddenSeedEvidenceIds ?? []);
      const seededEvidence = item.seed.evidence
        .map((entry, index) => ({
          id: `${control.internalControlId}:${item.itemId}:seed:${index}` as Id<'securityControlEvidence'>,
          title: entry.title,
          description: entry.description,
          evidenceType: entry.evidenceType,
          url: entry.url,
          storageId: null,
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          sufficiency: entry.sufficiency,
          reviewedAt: seededReviewedAt,
          createdAt: seededReviewedAt,
        }))
        .filter((entry) => !hiddenSeedEvidenceIds.has(entry.id));
      const persistedEvidence = (
        evidenceByKey.get(`${control.internalControlId}:${item.itemId}`) ?? []
      ).map((entry) => ({
        id: entry._id,
        title: entry.title,
        description: entry.description ?? null,
        evidenceType: entry.evidenceType,
        url: entry.url ?? null,
        storageId: entry.storageId ?? null,
        fileName: entry.fileName ?? null,
        mimeType: entry.mimeType ?? null,
        sizeBytes: entry.sizeBytes ?? null,
        sufficiency: entry.sufficiency,
        reviewedAt: entry.reviewedAt ?? null,
        createdAt: entry.createdAt,
      }));
      const evidence = [...seededEvidence, ...persistedEvidence];

      return {
        itemId: item.itemId,
        label: item.label,
        description: item.description,
        verificationMethod: item.verificationMethod,
        required: item.required,
        suggestedEvidenceTypes: item.suggestedEvidenceTypes,
        status: state?.status ?? item.seed.status,
        owner: state?.owner ?? item.seed.owner,
        notes: state?.notes ?? item.seed.notes,
        completedAt:
          state?.completedAt ??
          (item.seed.status === 'done' || item.seed.status === 'not_applicable'
            ? seededReviewedAt
            : null),
        lastReviewedAt:
          state?.lastReviewedAt ??
          (item.seed.evidence.length > 0 || item.seed.status !== 'not_started'
            ? seededReviewedAt
            : null),
        evidence,
        evidenceSufficiency: deriveItemEvidenceSufficiency(evidence),
      };
    });

    const platformImplementationStatus = derivePlatformImplementationStatus(platformChecklist);
    const evidenceReadiness = deriveEvidenceReadiness(platformChecklist);
    const lastReviewedAtCandidates = platformChecklist.flatMap((item) => [
      item.lastReviewedAt,
      item.completedAt,
      ...item.evidence.flatMap((evidence) => [evidence.reviewedAt, evidence.createdAt]),
    ]);
    const lastReviewedAt = lastReviewedAtCandidates.reduce<number | null>((latest, value) => {
      if (typeof value !== 'number') {
        return latest;
      }
      return latest === null ? value : Math.max(latest, value);
    }, null);

    return {
      internalControlId: control.internalControlId,
      nist80053Id: control.nist80053Id,
      title: control.title,
      familyId: control.familyId,
      familyTitle: control.familyTitle,
      owner: control.owner,
      priority: control.priority,
      responsibility: control.responsibility,
      implementationSummary: control.implementationSummary,
      customerResponsibilityNotes: control.customerResponsibilityNotes,
      controlStatement: control.controlStatement,
      mappings: control.mappings,
      coverage: platformImplementationStatus,
      platformImplementationStatus,
      evidenceReadiness,
      lastReviewedAt,
      platformChecklist,
    };
  });
}

export const createEvidenceReport = internalMutation({
  args: {
    contentJson: v.string(),
    contentHash: v.string(),
    generatedByUserId: v.string(),
    organizationId: v.optional(v.string()),
    reportKind: v.union(v.literal('security_posture'), v.literal('audit_integrity')),
  },
  returns: v.id('evidenceReports'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('evidenceReports', {
      ...args,
      exportBundleJson: undefined,
      exportHash: undefined,
      exportIntegritySummary: undefined,
      exportedAt: null,
      exportedByUserId: null,
      reviewStatus: 'pending',
      reviewedAt: null,
      reviewedByUserId: null,
      reviewNotes: null,
      createdAt: Date.now(),
    });
  },
});

export const getSecurityPostureSummary = query({
  args: {},
  returns: securityPostureSummaryValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);

    const [
      authUsers,
      passkeys,
      latestScan,
      latestRetentionJob,
      latestBackupCheck,
      latestAuditEvent,
      integrityFailures,
      totalScans,
      quarantinedScans,
      rejectedScans,
    ] =
      await Promise.all([
        fetchAllBetterAuthUsers(ctx),
        fetchAllBetterAuthPasskeys(ctx),
        ctx.db.query('documentScanEvents').withIndex('by_created_at').order('desc').first(),
        ctx.db.query('retentionJobs').withIndex('by_created_at').order('desc').first(),
        ctx.db.query('backupVerificationReports').withIndex('by_checked_at').order('desc').first(),
        ctx.db.query('auditLogs').withIndex('by_createdAt').order('desc').first(),
        ctx.db
          .query('auditLogs')
          .withIndex('by_eventType_and_createdAt', (q) => q.eq('eventType', 'audit_integrity_check_failed'))
          .collect(),
        ctx.db.query('documentScanEvents').collect(),
        ctx.db
          .query('documentScanEvents')
          .filter((q) => q.eq(q.field('resultStatus'), 'quarantined'))
          .collect(),
        ctx.db
          .query('documentScanEvents')
          .filter((q) => q.eq(q.field('resultStatus'), 'rejected'))
          .collect(),
      ]);

    const totalUsers = authUsers.length;
    const usersWithPasskeys = new Set(
      passkeys
        .map((passkey) => passkey.userId)
        .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
    );
    const mfaEnabledUsers = authUsers.filter(
      (user) => user.twoFactorEnabled === true || usersWithPasskeys.has(user._id),
    ).length;
    const passkeyEnabledUsers = authUsers.filter((user) => usersWithPasskeys.has(user._id)).length;
    const retentionPolicy = getRetentionPolicyConfig();
    const vendorPosture = getVendorBoundarySnapshot();
    const sentryPosture = vendorPosture.find((vendor) => vendor.vendor === 'sentry');

    return {
      audit: {
        integrityFailures: integrityFailures.length,
        lastEventAt: latestAuditEvent?.createdAt ?? null,
      },
      auth: {
        emailVerificationRequired: ALWAYS_ON_REGULATED_BASELINE.requireVerifiedEmail,
        mfaCoveragePercent: totalUsers === 0 ? 0 : Math.round((mfaEnabledUsers / totalUsers) * 100),
        mfaEnabledUsers,
        passkeyEnabledUsers,
        totalUsers,
      },
      backups: {
        lastCheckedAt: latestBackupCheck?.checkedAt ?? null,
        lastStatus: latestBackupCheck?.status ?? null,
      },
      retention: {
        lastJobAt: latestRetentionJob?.createdAt ?? null,
        lastJobStatus: latestRetentionJob?.status ?? null,
      },
      scanner: {
        lastScanAt: latestScan?.createdAt ?? null,
        quarantinedCount: quarantinedScans.length,
        rejectedCount: rejectedScans.length,
        totalScans: totalScans.length,
      },
      sessions: {
        freshWindowMinutes: retentionPolicy.recentStepUpWindowMinutes,
        sessionExpiryHours: 24,
        temporaryLinkTtlMinutes: retentionPolicy.attachmentUrlTtlMinutes,
      },
      telemetry: {
        sentryApproved: sentryPosture?.approved ?? false,
        sentryEnabled: Boolean(process.env.VITE_SENTRY_DSN) && (sentryPosture?.approved ?? false),
      },
      vendors: vendorPosture,
    };
  },
});

export const listSecurityControlWorkspaces = query({
  args: {},
  returns: securityControlWorkspaceListValidator,
  handler: async (ctx) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    return await listSecurityControlWorkspaceRecords(ctx);
  },
});

export const updateSecurityControlChecklistItem = mutation({
  args: {
    internalControlId: v.string(),
    itemId: v.string(),
    notes: v.optional(v.string()),
    owner: v.optional(v.string()),
    status: checklistStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
      )
      .unique();
    const now = Date.now();
    const patch = {
      status: args.status,
      owner: args.owner?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      completedAt:
        args.status === 'done' || args.status === 'not_applicable' ? now : undefined,
      completedByUserId:
        args.status === 'done' || args.status === 'not_applicable'
          ? currentUser.authUserId
          : undefined,
      lastReviewedAt: now,
      lastReviewedByUserId: currentUser.authUserId,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlChecklistItems', {
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        createdAt: now,
        ...patch,
      });
    }

    return null;
  },
});

export const hideSeededSecurityControlEvidence = mutation({
  args: {
    evidenceId: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('securityControlChecklistItems')
      .withIndex('by_internal_control_id_and_item_id', (q) =>
        q.eq('internalControlId', args.internalControlId).eq('itemId', args.itemId),
      )
      .unique();
    const now = Date.now();
    const nextHiddenSeedEvidenceIds = Array.from(
      new Set([...(existing?.hiddenSeedEvidenceIds ?? []), args.evidenceId]),
    );
    const patch = {
      hiddenSeedEvidenceIds: nextHiddenSeedEvidenceIds,
      lastReviewedAt: now,
      lastReviewedByUserId: currentUser.authUserId,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlChecklistItems', {
        internalControlId: args.internalControlId,
        itemId: args.itemId,
        status: 'not_started',
        createdAt: now,
        ...patch,
      });
    }

    return null;
  },
});

export const updateSecurityControlReviewState = mutation({
  args: {
    internalControlId: v.string(),
    reviewNotes: v.optional(v.string()),
    reviewStatus: v.union(v.literal('pending'), v.literal('reviewed'), v.literal('needs_follow_up')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const existing = await ctx.db
      .query('securityControlStates')
      .withIndex('by_internal_control_id', (q) => q.eq('internalControlId', args.internalControlId))
      .unique();
    const now = Date.now();
    const patch = {
      reviewNotes: args.reviewNotes?.trim() || undefined,
      reviewStatus: args.reviewStatus,
      reviewedAt: args.reviewStatus === 'reviewed' ? now : undefined,
      reviewedByUserId: args.reviewStatus === 'reviewed' ? currentUser.authUserId : undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('securityControlStates', {
        internalControlId: args.internalControlId,
        createdAt: now,
        ...patch,
      });
    }
    return null;
  },
});

export const addSecurityControlEvidenceLink = mutation({
  args: {
    description: v.optional(v.string()),
    internalControlId: v.string(),
    itemId: v.string(),
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    url: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const now = Date.now();
    return await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'link',
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      url: args.url.trim(),
      sufficiency: args.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addSecurityControlEvidenceNote = mutation({
  args: {
    description: v.string(),
    internalControlId: v.string(),
    itemId: v.string(),
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const now = Date.now();
    return await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'note',
      title: args.title.trim(),
      description: args.description.trim(),
      sufficiency: args.sufficiency,
      uploadedByUserId: currentUser.authUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createSecurityControlEvidenceUploadTarget = action({
  args: {
    contentType: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
  },
  returns: v.object({
    backend: v.union(v.literal('convex'), v.literal('s3')),
    backendMode: v.union(v.literal('convex'), v.literal('s3-primary'), v.literal('s3-mirror')),
    expiresAt: v.number(),
    storageId: v.string(),
    uploadFields: v.optional(v.record(v.string(), v.string())),
    uploadHeaders: v.optional(v.record(v.string(), v.string())),
    uploadMethod: v.union(v.literal('POST'), v.literal('PUT')),
    uploadUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const target = await ctx.runAction(anyApi.storagePlatform.createUploadTarget, {
      contentType: args.contentType,
      fileName: args.fileName,
      fileSize: args.fileSize,
      sourceId: `${args.internalControlId}:${args.itemId}`,
      sourceType: 'security_control_evidence',
    });

    return {
      ...target,
      backendMode:
        target.backend === 'convex'
          ? 'convex'
          : (process.env.FILE_STORAGE_BACKEND_MODE === 's3-mirror'
              ? 's3-mirror'
              : 's3-primary'),
    };
  },
});

export const finalizeSecurityControlEvidenceUpload = action({
  args: {
    backendMode: v.union(v.literal('convex'), v.literal('s3-primary'), v.literal('s3-mirror')),
    description: v.optional(v.string()),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    mimeType: v.string(),
    storageId: v.string(),
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args): Promise<Id<'securityControlEvidence'>> => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    await ctx.runAction(internal.storagePlatform.finalizeUploadInternal, {
      backendMode: args.backendMode,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
      sourceId: `${args.internalControlId}:${args.itemId}`,
      sourceType: 'security_control_evidence',
      storageId: args.storageId,
    });

    return await ctx.runMutation(internal.security.createSecurityControlEvidenceFileInternal, {
      description: args.description?.trim() || undefined,
      fileName: args.fileName,
      fileSize: args.fileSize,
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      mimeType: args.mimeType,
      storageId: args.storageId,
      sufficiency: args.sufficiency,
      title: args.title.trim(),
      uploadedByUserId: currentUser.authUserId,
    });
  },
});

export const removeSecurityControlEvidence = action({
  args: {
    evidenceId: v.id('securityControlEvidence'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const evidence = await ctx.runQuery(internal.security.getSecurityControlEvidenceInternal, {
      evidenceId: args.evidenceId,
    });
    if (!evidence) {
      return null;
    }
    if (evidence.storageId) {
      await ctx.runAction(internal.storagePlatform.deleteStoredFileInternal, {
        storageId: evidence.storageId,
      });
    }
    await ctx.runMutation(internal.security.deleteSecurityControlEvidenceInternal, {
      evidenceId: args.evidenceId,
    });
    return null;
  },
});

export const getSecurityControlEvidenceInternal = internalQuery({
  args: {
    evidenceId: v.id('securityControlEvidence'),
  },
  returns: v.union(
    v.object({
      _id: v.id('securityControlEvidence'),
      storageId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) {
      return null;
    }
    return {
      _id: evidence._id,
      storageId: evidence.storageId,
    };
  },
});

export const createSecurityControlEvidenceFileInternal = internalMutation({
  args: {
    description: v.optional(v.string()),
    fileName: v.string(),
    fileSize: v.number(),
    internalControlId: v.string(),
    itemId: v.string(),
    mimeType: v.string(),
    storageId: v.string(),
    sufficiency: evidenceSufficiencyValidator,
    title: v.string(),
    uploadedByUserId: v.string(),
  },
  returns: v.id('securityControlEvidence'),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('securityControlEvidence', {
      internalControlId: args.internalControlId,
      itemId: args.itemId,
      evidenceType: 'file',
      title: args.title,
      description: args.description,
      storageId: args.storageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      sizeBytes: args.fileSize,
      sufficiency: args.sufficiency,
      uploadedByUserId: args.uploadedByUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteSecurityControlEvidenceInternal = internalMutation({
  args: {
    evidenceId: v.id('securityControlEvidence'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.evidenceId);
    return null;
  },
});

export const listEvidenceReports = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: evidenceReportListValidator,
  handler: async (ctx, args) => {
    await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 20, 100));
    const reports = await ctx.db.query('evidenceReports').withIndex('by_created_at').order('desc').take(limit);
    return reports.map((report) => ({
      id: report._id,
      createdAt: report.createdAt,
      generatedByUserId: report.generatedByUserId,
      reportKind: report.reportKind,
      contentHash: report.contentHash,
      exportHash: report.exportHash ?? null,
      exportedAt: report.exportedAt ?? null,
      exportedByUserId: report.exportedByUserId ?? null,
      reviewStatus: report.reviewStatus,
      reviewedAt: report.reviewedAt ?? null,
      reviewedByUserId: report.reviewedByUserId ?? null,
      reviewNotes: report.reviewNotes ?? null,
    }));
  },
});

export const reviewEvidenceReport = mutation({
  args: {
    id: v.id('evidenceReports'),
    reviewNotes: v.optional(v.string()),
    reviewStatus: v.union(v.literal('reviewed'), v.literal('needs_follow_up')),
  },
  returns: evidenceReportRecordValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserOrThrow(ctx);
    const report = await ctx.db.get(args.id);
    if (!report) {
      throw new Error('Evidence report not found');
    }

    const reviewedAt = Date.now();
    await ctx.db.patch(args.id, {
      reviewNotes: args.reviewNotes?.trim() || null,
      reviewStatus: args.reviewStatus,
      reviewedAt,
      reviewedByUserId: currentUser.authUserId,
    });

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'evidence_report_reviewed',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: report._id,
      resourceLabel: report.reportKind,
      resourceType: 'evidence_report',
      severity: args.reviewStatus === 'reviewed' ? 'info' : 'warning',
      sourceSurface: 'admin.security',
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        reviewNotes: args.reviewNotes?.trim() || null,
        reviewStatus: args.reviewStatus,
      }),
    });

    const updated = await ctx.db.get(args.id);
    if (!updated) {
      throw new Error('Evidence report not found after update');
    }

    return updated;
  },
});

export const exportEvidenceReport = action({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: evidenceReportValidator,
  handler: async (ctx, args) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const report = await ctx.runQuery(anyApi.security.getEvidenceReportInternal, {
      id: args.id,
    });
    if (!report) {
      throw new Error('Evidence report not found');
    }

    const exportBundle = stringifyStable({
      contentHash: report.contentHash,
      exportedAt: new Date().toISOString(),
      integritySummary: {
        contentHash: report.contentHash,
        reviewedAt: report.reviewedAt ?? null,
        reviewStatus: report.reviewStatus,
      },
      report: JSON.parse(report.contentJson),
      reportId: report._id,
    });
    const exportHash = await hashContent(exportBundle);
    const exportedAt = Date.now();
    const exportIntegritySummary = stringifyStable({
      contentHash: report.contentHash,
      exportHash,
      reviewStatus: report.reviewStatus,
    });

    await ctx.runMutation(anyApi.security.storeEvidenceReportExport, {
      id: args.id,
      exportBundleJson: exportBundle,
      exportHash,
      exportIntegritySummary,
      exportedAt,
      exportedByUserId: currentUser.authUserId,
    });

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'evidence_report_exported',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: report._id,
      resourceLabel: report.reportKind,
      resourceType: 'evidence_report',
      severity: 'info',
      sourceSurface: 'admin.security',
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        exportHash,
      }),
    });

    return {
      createdAt: report.createdAt,
      exportHash,
      id: report._id,
      report: exportBundle,
      reviewStatus: report.reviewStatus,
    };
  },
});

export const getEvidenceReportInternal = internalQuery({
  args: {
    id: v.id('evidenceReports'),
  },
  returns: v.union(evidenceReportRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.id)) ?? null;
  },
});

export const storeEvidenceReportExport = internalMutation({
  args: {
    id: v.id('evidenceReports'),
    exportBundleJson: v.string(),
    exportHash: v.string(),
    exportIntegritySummary: v.string(),
    exportedAt: v.number(),
    exportedByUserId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      exportBundleJson: args.exportBundleJson,
      exportHash: args.exportHash,
      exportIntegritySummary: args.exportIntegritySummary,
      exportedAt: args.exportedAt,
      exportedByUserId: args.exportedByUserId,
    });
    return null;
  },
});

export const generateEvidenceReport = action({
  args: {},
  returns: evidenceReportValidator,
  handler: async (ctx) => {
    const currentUser = await getVerifiedCurrentSiteAdminUserFromActionOrThrow(ctx);
    const summary = await ctx.runQuery(anyApi.security.getSecurityPostureSummary, {});
    const controlWorkspace = await ctx.runQuery(anyApi.security.listSecurityControlWorkspaces, {});
    const recentAuditLogs: Array<{
      createdAt: number;
      eventType: string;
      organizationId?: string;
      outcome?: 'success' | 'failure';
      resourceType?: string;
      sourceSurface?: string;
    }> = await ctx.runQuery(anyApi.audit.getRecentAuditLogsInternal, {
      limit: 25,
    });
    const integrityCheck = await ctx.runAction(anyApi.audit.verifyAuditIntegrityInternal, {
      limit: 250,
    });
    const currentOrganizationPolicies = currentUser.activeOrganizationId
      ? await ctx.runQuery(anyApi.organizationManagement.getOrganizationPolicies, {
          organizationId: currentUser.activeOrganizationId,
        })
      : null;
    const vendorPosture = getVendorBoundarySnapshot();
    const createdAt = Date.now();
    const reportPayload = {
        generatedAt: new Date(createdAt).toISOString(),
        generatedByUserId: currentUser.authUserId,
        baselineDefaults: {
          organizationPolicies: REGULATED_ORGANIZATION_POLICY_DEFAULTS,
        },
        sessionPolicy: {
          sessionExpiryHours: 24,
          sessionRefreshHours: 4,
          recentStepUpWindowMinutes: getRetentionPolicyConfig().recentStepUpWindowMinutes,
          temporaryLinkTtlMinutes: getRetentionPolicyConfig().attachmentUrlTtlMinutes,
        },
        telemetryPosture: {
          sentryApproved: vendorPosture.some(
            (vendor) => vendor.vendor === 'sentry' && vendor.approved,
          ),
          sentryEnabled:
            vendorPosture.some((vendor) => vendor.vendor === 'sentry' && vendor.approved) &&
            Boolean(process.env.VITE_SENTRY_DSN),
        },
        vendorBoundary: vendorPosture,
        verificationPosture: {
          emailVerificationRequired: ALWAYS_ON_REGULATED_BASELINE.requireVerifiedEmail,
          mfaRequired: ALWAYS_ON_REGULATED_BASELINE.requireMfaOrPasskey,
        },
        integrityCheck,
        recentAuditEvents: recentAuditLogs.slice(0, 10).map((log) => ({
          createdAt: log.createdAt,
          eventType: log.eventType,
          outcome: log.outcome ?? null,
          organizationId: log.organizationId ?? null,
          resourceType: log.resourceType ?? null,
          sourceSurface: log.sourceSurface ?? null,
        })),
        scopedOrganizationPolicies: currentOrganizationPolicies,
        summary,
        controls: controlWorkspace,
      };
    const report = stringifyStable(reportPayload);
    const contentHash = await hashContent(report);

    const id = await ctx.runMutation(anyApi.security.createEvidenceReport, {
      contentJson: report,
      contentHash,
      generatedByUserId: currentUser.authUserId,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      reportKind: 'security_posture',
    });

    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'evidence_report_generated',
      identifier: currentUser.authUser.email ?? undefined,
      organizationId: currentUser.activeOrganizationId ?? undefined,
      outcome: 'success',
      resourceId: id,
      resourceLabel: 'security_posture',
      resourceType: 'evidence_report',
      severity: 'info',
      sourceSurface: 'admin.security',
      userId: currentUser.authUserId,
      metadata: stringifyStable({
        contentHash,
      }),
    });

    return {
      createdAt,
      exportHash: null,
      id,
      report,
      reviewStatus: 'pending' as const,
    };
  },
});

export const cleanupExpiredAttachments = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const expiredAttachments = await ctx.runQuery(anyApi.security.listExpiredAttachmentsInternal, {
      now,
    });

    let processedCount = 0;

    for (const attachment of expiredAttachments) {
      if (attachment.extractedTextStorageId) {
        await ctx.storage.delete(attachment.extractedTextStorageId);
      }

      await ctx.runAction(anyApi.storagePlatform.deleteStoredFileInternal, {
        storageId: attachment.storageId,
      });

      await ctx.runMutation(anyApi.agentChat.deleteAttachmentStorageInternal, {
        attachmentId: attachment._id,
      });
      processedCount += 1;
    }

    await ctx.runMutation(anyApi.security.recordRetentionJob, {
      details: processedCount > 0 ? `Purged ${processedCount} expired attachments` : undefined,
      jobKind: 'attachment_purge',
      processedCount,
      status: 'success',
    });

    return null;
  },
});

export const listExpiredAttachmentsInternal = internalQuery({
  args: {
    now: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id('chatAttachments'),
      extractedTextStorageId: v.optional(v.id('_storage')),
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query('chatAttachments')
      .withIndex('by_purgeEligibleAt', (q) => q.lt('purgeEligibleAt', args.now))
      .collect();

    return expired.map((attachment) => ({
      _id: attachment._id,
      extractedTextStorageId: attachment.extractedTextStorageId,
      storageId: attachment.storageId,
    }));
  },
});
