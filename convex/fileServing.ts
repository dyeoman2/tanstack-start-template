'use node';

import { anyApi } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { getRetentionPolicyConfig } from '../src/lib/server/security-config.server';
import { getStorageRuntimeConfig } from '../src/lib/server/env.server';
import { STEP_UP_REQUIREMENTS } from '../src/lib/shared/auth-policy';
import { internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import {
  getVerifiedCurrentUserFromActionOrThrow,
  requireStorageReadAccessFromActionOrThrow,
} from './auth/access';
import { createPresignedS3Url } from './lib/storageS3';
import { getStorageReadiness } from './storageReadiness';

const FILE_ACCESS_TICKET_MAX_TTL_MINUTES = 15;
const FILE_ACCESS_TICKET_MIN_TTL_MINUTES = 1;
const FILE_DOWNLOAD_PRESIGN_EXPIRY_SECONDS = 60;
type FileServingCtx = Pick<ActionCtx, 'runMutation' | 'runQuery'>;
type FileAccessPurpose = 'external_share' | 'interactive_open';
type IssuedFileAccessUrl = {
  expiresAt: number;
  storageId: string;
  ticketId: string;
  url: string;
};

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined) {
      return false;
    }
    mismatch |= leftByte ^ rightByte;
  }
  return mismatch === 0;
}

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (part) => part.toString(16).padStart(2, '0')).join(
    '',
  );
}

function buildTicketServeUrl(params: {
  convexSiteUrl: string;
  expiresAt: number;
  signature: string;
  ticketId: string;
}) {
  return `${params.convexSiteUrl}/api/files/serve?ticket=${encodeURIComponent(params.ticketId)}&exp=${encodeURIComponent(String(params.expiresAt))}&sig=${encodeURIComponent(params.signature)}`;
}

async function createFileAccessTicketSignature(ticketId: string, expiresAt: number) {
  const runtimeConfig = getStorageRuntimeConfig();
  if (!runtimeConfig.fileServeSigningSecret) {
    throw new ConvexError('AWS_FILE_SERVE_SIGNING_SECRET is not configured.');
  }
  return await sign(runtimeConfig.fileServeSigningSecret, `file_ticket:${ticketId}:${expiresAt}`);
}

async function verifyFileAccessTicketSignature(
  ticketId: string,
  signature: string,
  expiresAt: number,
) {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ConvexError('File access ticket has expired.');
  }

  const expected = await createFileAccessTicketSignature(ticketId, expiresAt);
  if (!timingSafeEqual(expected, signature)) {
    throw new ConvexError('Invalid file access ticket signature.');
  }
}

function clampTemporaryLinkTtlMinutes(value: number) {
  if (!Number.isFinite(value)) {
    return FILE_ACCESS_TICKET_MAX_TTL_MINUTES;
  }

  return Math.min(
    FILE_ACCESS_TICKET_MAX_TTL_MINUTES,
    Math.max(FILE_ACCESS_TICKET_MIN_TTL_MINUTES, Math.floor(value)),
  );
}

async function resolveTemporaryLinkTtlMinutes(
  ctx: ActionCtx,
  organizationId: string | null | undefined,
): Promise<number> {
  if (!organizationId) {
    return clampTemporaryLinkTtlMinutes(getRetentionPolicyConfig().attachmentUrlTtlMinutes);
  }

  const policy = (await ctx.runQuery(
    internal.organizationManagement.getOrganizationPoliciesInternal,
    {
      organizationId,
    },
  )) as { temporaryLinkTtlMinutes: number };
  return clampTemporaryLinkTtlMinutes(policy.temporaryLinkTtlMinutes);
}

async function isAttachmentSharingAllowed(
  ctx: ActionCtx,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId) {
    return true;
  }

  const policy = (await ctx.runQuery(
    internal.organizationManagement.getOrganizationPoliciesInternal,
    {
      organizationId,
    },
  )) as { attachmentSharingAllowed: boolean };
  return policy.attachmentSharingAllowed;
}

async function recordFileAccessAuditEvent(
  ctx: FileServingCtx,
  args: {
    eventType:
      | 'attachment_access_url_issued'
      | 'file_access_redeemed'
      | 'file_access_redeem_failed'
      | 'file_access_ticket_issued';
    metadata: Record<string, unknown>;
    organizationId?: string | null;
    outcome: 'failure' | 'success';
    resourceId: string;
    resourceLabel?: string | null;
    resourceType: string;
    sessionId?: string | null;
    severity?: 'critical' | 'info' | 'warning';
    sourceSurface: string;
    userId?: string | null;
  },
) {
  await ctx.runMutation(anyApi.audit.insertAuditLog, {
    actorUserId: args.userId ?? undefined,
    eventType: args.eventType,
    metadata: JSON.stringify(args.metadata),
    organizationId: args.organizationId ?? undefined,
    outcome: args.outcome,
    resourceId: args.resourceId,
    resourceLabel: args.resourceLabel ?? undefined,
    resourceType: args.resourceType,
    sessionId: args.sessionId ?? undefined,
    severity: args.severity ?? (args.outcome === 'success' ? 'info' : 'warning'),
    sourceSurface: args.sourceSurface,
    userId: args.userId ?? undefined,
  });
}

async function resolveServeRedirect(ctx: FileServingCtx, storageId: string) {
  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId,
  });
  if (!lifecycle) {
    throw new ConvexError('Stored file not found.');
  }

  const runtimeConfig = getStorageRuntimeConfig();
  const readiness = getStorageReadiness(lifecycle, {
    allowLegacyPrimaryReads: runtimeConfig.allowLegacyPrimaryReads,
  });
  if (!readiness.readable) {
    throw new ConvexError(readiness.message);
  }

  const bucket =
    lifecycle.backendMode === 's3-primary' ? lifecycle.canonicalBucket : lifecycle.mirrorBucket;
  const key = lifecycle.backendMode === 's3-primary' ? lifecycle.canonicalKey : lifecycle.mirrorKey;

  if (!bucket || !key) {
    throw new ConvexError('Stored file does not have an S3 backing object.');
  }

  const presigned = await createPresignedS3Url({
    bucket,
    expiresInSeconds: FILE_DOWNLOAD_PRESIGN_EXPIRY_SECONDS,
    key,
    method: 'GET',
  });

  return {
    storageId,
    url: presigned.url,
  };
}

export async function issueFileAccessUrlForCurrentUser(
  ctx: ActionCtx,
  args: {
    purpose: FileAccessPurpose;
    sourceSurface: string;
    storageId: string;
  },
): Promise<IssuedFileAccessUrl> {
  const access = await requireStorageReadAccessFromActionOrThrow(ctx, {
    storageId: args.storageId,
    sourceSurface: args.sourceSurface,
  });

  const lifecycle = await ctx.runQuery(internal.storageLifecycle.getByStorageIdInternal, {
    storageId: args.storageId,
  });
  const runtimeConfig = getStorageRuntimeConfig();
  const readiness = getStorageReadiness(lifecycle, {
    allowLegacyPrimaryReads: runtimeConfig.allowLegacyPrimaryReads,
  });
  if (!readiness.readable) {
    throw new ConvexError(readiness.message);
  }

  if (!runtimeConfig.convexSiteUrl) {
    throw new ConvexError('CONVEX_SITE_URL is not configured.');
  }

  const currentUser = await getVerifiedCurrentUserFromActionOrThrow(ctx);
  const issuedFromSessionId = currentUser.authSession?.id ?? null;
  if (!issuedFromSessionId) {
    throw new ConvexError('Current session could not be resolved.');
  }
  const organizationId = lifecycle?.organizationId ?? access.organizationId ?? null;
  if (
    args.purpose === 'external_share' &&
    !(await isAttachmentSharingAllowed(ctx, organizationId))
  ) {
    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'authorization_denied',
      metadata: JSON.stringify({
        policy: 'attachmentSharingAllowed',
        purpose: args.purpose,
        storageId: args.storageId,
      }),
      organizationId: organizationId ?? undefined,
      outcome: 'failure',
      resourceId: args.storageId,
      resourceLabel: lifecycle?.originalFileName ?? undefined,
      resourceType: lifecycle?.sourceType ?? 'stored_file',
      sessionId: issuedFromSessionId,
      severity: 'warning',
      sourceSurface: args.sourceSurface,
      userId: currentUser.authUserId,
    });
    throw new ConvexError('Attachment sharing is disabled by organization policy.');
  }
  const issuedFromIpAddress =
    typeof currentUser.authSession?.ipAddress === 'string' &&
    currentUser.authSession.ipAddress.trim()
      ? currentUser.authSession.ipAddress.trim()
      : 'unavailable';
  const issuedFromUserAgent =
    typeof currentUser.authSession?.userAgent === 'string' &&
    currentUser.authSession.userAgent.trim()
      ? currentUser.authSession.userAgent.trim()
      : 'unavailable';
  const ttlMinutes = await resolveTemporaryLinkTtlMinutes(ctx, organizationId);
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
  const ticketId = crypto.randomUUID();
  const signature = await createFileAccessTicketSignature(ticketId, expiresAt);

  await ctx.runMutation(internal.fileAccessTickets.createInternal, {
    expiresAt,
    ipAddress: issuedFromIpAddress,
    issuedFromSessionId,
    issuedToUserId: currentUser.authUserId,
    organizationId,
    purpose: args.purpose,
    sourceSurface: args.sourceSurface,
    storageId: args.storageId,
    ticketId,
    userAgent: issuedFromUserAgent,
  });

  await recordFileAccessAuditEvent(ctx, {
    eventType: 'file_access_ticket_issued',
    metadata: {
      expiresInMinutes: ttlMinutes,
      issuedIpAddress: issuedFromIpAddress,
      issuedUserAgent: issuedFromUserAgent,
      purpose: args.purpose,
      ticketId,
    },
    organizationId,
    outcome: 'success',
    resourceId: args.storageId,
    resourceLabel: lifecycle?.originalFileName ?? null,
    resourceType: lifecycle?.sourceType ?? 'stored_file',
    sessionId: issuedFromSessionId,
    sourceSurface: args.sourceSurface,
    userId: currentUser.authUserId,
  });

  if (args.purpose === 'external_share') {
    await ctx.runMutation(internal.stepUp.consumeClaimInternal, {
      authUserId: currentUser.authUserId,
      requirement: STEP_UP_REQUIREMENTS.attachmentAccess,
      sessionId: issuedFromSessionId,
    });
    await ctx.runMutation(anyApi.audit.insertAuditLog, {
      actorUserId: currentUser.authUserId,
      eventType: 'step_up_consumed',
      metadata: JSON.stringify({
        purpose: args.purpose,
        requirement: STEP_UP_REQUIREMENTS.attachmentAccess,
      }),
      organizationId: organizationId ?? undefined,
      outcome: 'success',
      resourceId: args.storageId,
      resourceLabel: lifecycle?.originalFileName ?? undefined,
      resourceType: lifecycle?.sourceType ?? 'stored_file',
      sessionId: issuedFromSessionId,
      severity: 'info',
      sourceSurface: args.sourceSurface,
      userId: currentUser.authUserId,
    });
  }

  return {
    expiresAt,
    storageId: args.storageId,
    ticketId,
    url: buildTicketServeUrl({
      convexSiteUrl: runtimeConfig.convexSiteUrl,
      expiresAt,
      signature,
      ticketId,
    }),
  };
}

export const createSignedServeUrl = action({
  args: { storageId: v.string() },
  returns: v.object({
    expiresAt: v.number(),
    storageId: v.string(),
    ticketId: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args): Promise<IssuedFileAccessUrl> => {
    await requireStorageReadAccessFromActionOrThrow(ctx, {
      sourceSurface: 'file.serve_url_create',
      storageId: args.storageId,
    });
    const issued = await issueFileAccessUrlForCurrentUser(ctx, {
      purpose: 'interactive_open',
      sourceSurface: 'file.serve_url_create',
      storageId: args.storageId,
    });

    return {
      expiresAt: issued.expiresAt,
      storageId: issued.storageId,
      ticketId: issued.ticketId,
      url: issued.url,
    };
  },
});

export async function redeemFileAccessTicketOrThrow(
  ctx: FileServingCtx,
  args: {
    authenticatedSessionId: string;
    authenticatedUserId: string;
    expiresAt: number;
    requestIpAddress: string | null;
    requestUserAgent: string | null;
    signature: string;
    ticketId: string;
  },
) {
  await verifyFileAccessTicketSignature(args.ticketId, args.signature, args.expiresAt);

  const ticket = await ctx.runMutation(internal.fileAccessTickets.redeemInternal, {
    redeemedAt: Date.now(),
    ticketId: args.ticketId,
  });
  if (!ticket) {
    throw new ConvexError('File access ticket not found.');
  }

  if (ticket.issuedToUserId !== args.authenticatedUserId) {
    throw new ConvexError('File access ticket does not belong to the current user.');
  }

  if (ticket.issuedFromSessionId !== args.authenticatedSessionId) {
    throw new ConvexError('File access ticket must be redeemed from the issuing session.');
  }

  const redirect = await resolveServeRedirect(ctx, ticket.storageId);
  await recordFileAccessAuditEvent(ctx, {
    eventType: 'file_access_redeemed',
    metadata: {
      ipAddress: args.requestIpAddress,
      purpose: ticket.purpose,
      sourceSurface: ticket.sourceSurface,
      ticketId: ticket.ticketId,
      userAgent: args.requestUserAgent,
    },
    organizationId: ticket.organizationId,
    outcome: 'success',
    resourceId: ticket.storageId,
    resourceType: 'stored_file',
    sessionId: args.authenticatedSessionId,
    sourceSurface: 'file.serve_redeem',
    userId: args.authenticatedUserId,
  });

  return redirect;
}

export async function recordFileAccessRedeemFailure(
  ctx: FileServingCtx,
  args: {
    authenticatedSessionId?: string | null;
    authenticatedUserId?: string | null;
    errorMessage: string;
    expiresAt?: number;
    requestIpAddress: string | null;
    requestUserAgent: string | null;
    ticketId: string;
  },
) {
  const ticket = await ctx.runQuery(internal.fileAccessTickets.getByTicketIdInternal, {
    ticketId: args.ticketId,
  });

  await recordFileAccessAuditEvent(ctx, {
    eventType: 'file_access_redeem_failed',
    metadata: {
      error: args.errorMessage,
      attemptedSessionId: args.authenticatedSessionId ?? null,
      attemptedUserId: args.authenticatedUserId ?? null,
      expiresAt: args.expiresAt ?? null,
      sourceSurface: ticket?.sourceSurface ?? null,
      ipAddress: args.requestIpAddress,
      ticketId: args.ticketId,
      userAgent: args.requestUserAgent,
    },
    organizationId: ticket?.organizationId ?? null,
    outcome: 'failure',
    resourceId: ticket?.storageId ?? args.ticketId,
    resourceType: 'stored_file',
    sessionId: args.authenticatedSessionId ?? null,
    sourceSurface: 'file.serve_redeem',
    userId: args.authenticatedUserId ?? null,
  });
}
