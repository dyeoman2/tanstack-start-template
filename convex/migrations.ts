import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery } from './_generated/server';
import {
  deriveIsSiteAdmin,
  normalizeUserRole,
} from '../src/features/auth/lib/user-role';
import { buildAttachmentPromptSummary, dataUrlToBlob } from './lib/chatAttachments';

const USER_PROFILES_BACKFILL_BATCH_SIZE = 100;
const ONBOARDING_BACKFILL_STATUS = 'not_started' as const;
const CHAT_ATTACHMENT_BACKFILL_BATCH_SIZE = 25;

export const backfillUserProfilesIsSiteAdminBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('userProfiles').paginate({
      cursor: args.cursor ?? null,
      numItems: USER_PROFILES_BACKFILL_BATCH_SIZE,
    });

    let updated = 0;

    for (const profile of result.page) {
      const nextIsSiteAdmin = deriveIsSiteAdmin(normalizeUserRole(profile.role));
      if (profile.isSiteAdmin === nextIsSiteAdmin) {
        continue;
      }

      await ctx.db.patch(profile._id, {
        isSiteAdmin: nextIsSiteAdmin,
      });
      updated += 1;
    }

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      updated,
    };
  },
});

export const runUserProfilesIsSiteAdminBackfill = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    let batches = 0;
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runMutation(
        internal.migrations.backfillUserProfilesIsSiteAdminBatch,
        {
          cursor,
        },
      );

      batches += 1;
      processed += result.processed;
      updated += result.updated;

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
    };
  },
});

export const backfillUserProfilesOnboardingStateBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('userProfiles').paginate({
      cursor: args.cursor ?? null,
      numItems: USER_PROFILES_BACKFILL_BATCH_SIZE,
    });

    let updated = 0;

    for (const profile of result.page) {
      if (profile.onboardingStatus !== undefined) {
        continue;
      }

      await ctx.db.patch(profile._id, {
        onboardingStatus: ONBOARDING_BACKFILL_STATUS,
        onboardingDeliveryError: null,
      });
      updated += 1;
    }

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      updated,
    };
  },
});

export const runUserProfilesOnboardingStateBackfill = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    let batches = 0;
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runMutation(
        internal.migrations.backfillUserProfilesOnboardingStateBatch,
        {
          cursor,
        },
      );

      batches += 1;
      processed += result.processed;
      updated += result.updated;

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
    };
  },
});

export const normalizeUserProfilesOnboardingBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('userProfiles').paginate({
      cursor: args.cursor ?? null,
      numItems: USER_PROFILES_BACKFILL_BATCH_SIZE,
    });

    let updated = 0;

    for (const profile of result.page) {
      const legacyNeedsOnboardingEmail =
        'needsOnboardingEmail' in profile ? profile.needsOnboardingEmail : undefined;
      const onboardingStatus =
        profile.onboardingStatus ??
        (legacyNeedsOnboardingEmail === true ? 'email_pending' : ONBOARDING_BACKFILL_STATUS);
      const onboardingDeliveryError = profile.onboardingDeliveryError ?? null;

      const normalizedProfile = {
        authUserId: profile.authUserId,
        email: profile.email,
        emailLower: profile.emailLower,
        name: profile.name,
        nameLower: profile.nameLower,
        phoneNumber: profile.phoneNumber,
        role: profile.role,
        isSiteAdmin: profile.isSiteAdmin,
        emailVerified: profile.emailVerified,
        banned: profile.banned,
        banReason: profile.banReason,
        banExpires: profile.banExpires,
        onboardingStatus,
        onboardingEmailId: profile.onboardingEmailId,
        onboardingEmailMessageId: profile.onboardingEmailMessageId,
        onboardingEmailLastSentAt: profile.onboardingEmailLastSentAt,
        onboardingCompletedAt: profile.onboardingCompletedAt,
        onboardingDeliveryUpdatedAt: profile.onboardingDeliveryUpdatedAt,
        onboardingDeliveryError,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        lastSyncedAt: profile.lastSyncedAt,
      };

      const needsReplace =
        legacyNeedsOnboardingEmail !== undefined ||
        profile.onboardingStatus === undefined ||
        profile.onboardingDeliveryError === undefined;

      if (!needsReplace) {
        continue;
      }

      await ctx.db.replace(profile._id, normalizedProfile);
      updated += 1;
    }

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      updated,
    };
  },
});

export const runUserProfilesOnboardingNormalization = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    let batches = 0;
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runMutation(internal.migrations.normalizeUserProfilesOnboardingBatch, {
        cursor,
      });

      batches += 1;
      processed += result.processed;
      updated += result.updated;

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
    };
  },
});

type LegacyChatMessagePart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      image: string;
      mimeType?: string;
      name?: string;
    }
  | {
      type: 'document';
      name: string;
      content: string;
      mimeType: string;
    }
  | {
      type: 'attachment';
      attachmentId: string;
      kind: 'image' | 'document';
      name: string;
      mimeType: string;
    }
  | {
      type: 'source-url';
      sourceId: string;
      url: string;
      title?: string;
    }
  | {
      type: 'source-document';
      sourceId: string;
      mediaType: string;
      title: string;
      filename?: string;
    };

export const getChatAttachmentBackfillBatch = internalQuery({
  args: {
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    continueCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    processed: v.number(),
    messages: v.array(
      v.object({
        _id: v.id('aiMessages'),
        threadId: v.id('aiThreads'),
        userId: v.string(),
        organizationId: v.string(),
        parts: v.array(v.any()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('aiMessages').paginate({
      cursor: args.cursor ?? null,
      numItems: CHAT_ATTACHMENT_BACKFILL_BATCH_SIZE,
    });

    return {
      continueCursor: result.isDone ? null : result.continueCursor,
      done: result.isDone,
      processed: result.page.length,
      messages: result.page.map((message) => ({
        _id: message._id,
        threadId: message.threadId,
        userId: message.userId,
        organizationId: message.organizationId,
        parts: message.parts,
      })),
    };
  },
});

export const runChatAttachmentBackfill = action({
  args: {},
  returns: v.object({
    batches: v.number(),
    processed: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    let batches = 0;
    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    while (true) {
      const result = await ctx.runQuery(internal.migrations.getChatAttachmentBackfillBatch, {
        cursor,
      });

      batches += 1;
      processed += result.processed;

      for (const message of result.messages) {
        const nextParts: LegacyChatMessagePart[] = [];
        let changed = false;

        for (const part of message.parts as LegacyChatMessagePart[]) {
          if (part.type === 'image') {
            const blob = dataUrlToBlob(part.image);
            const storageId = await ctx.storage.store(blob);
            const attachmentId = await ctx.runMutation(internal.chat.createAttachmentInternal, {
              messageId: message._id,
              threadId: message.threadId,
              userId: message.userId,
              organizationId: message.organizationId,
              kind: 'image',
              name: part.name ?? 'image',
              mimeType: (part.mimeType ?? blob.type) || 'image/png',
              sizeBytes: blob.size,
              rawStorageId: storageId,
              extractedTextStorageId: undefined,
              promptSummary: buildAttachmentPromptSummary({
                kind: 'image',
                name: part.name ?? 'image',
              }),
              status: 'ready',
              errorMessage: undefined,
            });

            nextParts.push({
              type: 'attachment',
              attachmentId,
              kind: 'image',
              name: part.name ?? 'image',
              mimeType: (part.mimeType ?? blob.type) || 'image/png',
            });
            changed = true;
            continue;
          }

          if (part.type === 'document') {
            const extractedTextStorageId = await ctx.storage.store(
              new Blob([part.content], { type: 'text/plain' }),
            );
            const attachmentId = await ctx.runMutation(internal.chat.createAttachmentInternal, {
              messageId: message._id,
              threadId: message.threadId,
              userId: message.userId,
              organizationId: message.organizationId,
              kind: 'document',
              name: part.name,
              mimeType: part.mimeType,
              sizeBytes: part.content.length,
              rawStorageId: undefined,
              extractedTextStorageId,
              promptSummary: buildAttachmentPromptSummary({
                kind: 'document',
                name: part.name,
                text: part.content,
              }),
              status: 'ready',
              errorMessage: undefined,
            });

            nextParts.push({
              type: 'attachment',
              attachmentId,
              kind: 'document',
              name: part.name,
              mimeType: part.mimeType,
            });
            changed = true;
            continue;
          }

          nextParts.push(part);
        }

        if (!changed) {
          continue;
        }

        await ctx.runMutation(internal.chat.replaceMessagePartsInternal, {
          messageId: message._id,
          parts: nextParts as never,
        });
        updated += 1;
      }

      if (result.done || result.continueCursor === null) {
        break;
      }

      cursor = result.continueCursor;
    }

    return {
      batches,
      processed,
      updated,
    };
  },
});
