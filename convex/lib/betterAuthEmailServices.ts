'use node';

import type { GenericCtx } from '@convex-dev/better-auth';
import type { BetterAuthOptions } from 'better-auth';
import {
  getRequiredBetterAuthUrl,
  isE2EPrincipalEmail,
  isTrustedBetterAuthOrigin,
} from '../../src/lib/server/env.server';
import { components, internal } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import type { SharedSendInvitationEmail } from '../betterAuth/sharedOptions';

type SchedulerCapableCtx = GenericCtx<DataModel> & {
  scheduler?: {
    runAfter: (delay: number, fn: unknown, args: unknown) => Promise<void>;
  };
};

type MutationCapableCtx = GenericCtx<DataModel> & {
  runMutation?: (fn: unknown, args: unknown) => Promise<{ ok: boolean; retryAfter?: number }>;
};

type BetterAuthEmailAndPasswordOptions = NonNullable<BetterAuthOptions['emailAndPassword']>;
type BetterAuthEmailVerificationOptions = NonNullable<BetterAuthOptions['emailVerification']>;
type BetterAuthUserOptions = NonNullable<BetterAuthOptions['user']>;

type SendResetPassword = NonNullable<BetterAuthEmailAndPasswordOptions['sendResetPassword']>;
type SendVerificationEmail = NonNullable<
  BetterAuthEmailVerificationOptions['sendVerificationEmail']
>;
type SendChangeEmailConfirmation = NonNullable<
  NonNullable<BetterAuthUserOptions['changeEmail']>['sendChangeEmailConfirmation']
>;

export function shouldSkipE2EAuthEmailForTesting(targetEmail: string): boolean {
  return isE2EPrincipalEmail(targetEmail);
}

function logSkippedE2EAuthEmail(
  kind: 'invitation' | 'password reset' | 'verification' | 'email change',
  email: string,
) {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  console.info(`[auth] Skipping ${kind} email for E2E principal ${email}`);
}

export function resolveAuthEmailUrl(url: string, request?: Request): string {
  let canonicalUrl: URL;

  try {
    canonicalUrl = new URL(url, getRequiredBetterAuthUrl());
  } catch {
    return url;
  }

  if (!request) {
    return canonicalUrl.toString();
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    if (!isTrustedBetterAuthOrigin(requestOrigin)) {
      return canonicalUrl.toString();
    }

    const nextOrigin = new URL(requestOrigin);
    canonicalUrl.protocol = nextOrigin.protocol;
    canonicalUrl.host = nextOrigin.host;
    return canonicalUrl.toString();
  } catch {
    return canonicalUrl.toString();
  }
}

function requireScheduler(ctx: GenericCtx<DataModel>, message: string) {
  const ctxWithScheduler = ctx as SchedulerCapableCtx;
  if (!ctxWithScheduler.scheduler) {
    throw new Error(message);
  }

  return ctxWithScheduler.scheduler;
}

function normalizeEmailUser(user: { email: string; id: string; name?: string | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
  };
}

export function createSendInvitationEmailHandler(
  ctx: GenericCtx<DataModel>,
): SharedSendInvitationEmail {
  return async (data, request) => {
    if (shouldSkipE2EAuthEmailForTesting(data.email)) {
      logSkippedE2EAuthEmail('invitation', data.email);
      return;
    }

    const scheduler = requireScheduler(
      ctx,
      'Cannot send organization invitation email: scheduler not available',
    );

    await scheduler.runAfter(0, internal.emails.sendOrganizationInviteEmailMutation, {
      email: data.email,
      inviteUrl: resolveAuthEmailUrl(`/invite/${data.id}`, request),
      inviterName: data.inviter.user.name ?? data.inviter.user.email,
      organizationName: data.organization.name,
      role: data.role,
    });
  };
}

export function createSendResetPasswordHandler(ctx: GenericCtx<DataModel>): SendResetPassword {
  return async ({ user, url, token }, request) => {
    if (shouldSkipE2EAuthEmailForTesting(user.email)) {
      logSkippedE2EAuthEmail('password reset', user.email);
      return;
    }

    const ctxWithRunMutation = ctx as MutationCapableCtx;
    if (!ctxWithRunMutation.runMutation) {
      throw new Error('Rate limiter mutation unavailable in current context');
    }

    const rateLimitResult = await ctxWithRunMutation.runMutation(
      components.rateLimiter.lib.rateLimit,
      {
        name: 'passwordReset',
        key: `passwordReset:${user.email}`,
        config: {
          kind: 'token bucket',
          rate: 3,
          period: 60 * 60 * 1000,
          capacity: 3,
        },
      },
    );

    if (!rateLimitResult.ok) {
      console.warn('[auth] Suppressed password reset email after per-account rate limit', {
        email: user.email,
        retryAfterMs: rateLimitResult.retryAfter ?? null,
      });
      return;
    }

    const scheduler = requireScheduler(ctx, 'Cannot send email: scheduler not available');
    await scheduler.runAfter(0, internal.emails.sendPasswordResetEmailMutation, {
      user: normalizeEmailUser(user),
      url: resolveAuthEmailUrl(url, request),
      token,
    });
  };
}

export function createSendChangeEmailConfirmationHandler(
  ctx: GenericCtx<DataModel>,
): SendChangeEmailConfirmation {
  return async ({ newEmail, token, url, user }, request) => {
    if (shouldSkipE2EAuthEmailForTesting(user.email)) {
      logSkippedE2EAuthEmail('email change', user.email);
      return;
    }

    const scheduler = requireScheduler(
      ctx,
      'Cannot send change email confirmation: scheduler not available',
    );
    await scheduler.runAfter(0, internal.emails.sendChangeEmailConfirmationMutation, {
      user: normalizeEmailUser(user),
      newEmail,
      token,
      url: resolveAuthEmailUrl(url, request),
    });
  };
}

export function createSendVerificationEmailHandler(
  ctx: GenericCtx<DataModel>,
): SendVerificationEmail {
  return async ({ user, url, token }, request) => {
    if (shouldSkipE2EAuthEmailForTesting(user.email)) {
      logSkippedE2EAuthEmail('verification', user.email);
      return;
    }

    const scheduler = requireScheduler(
      ctx,
      'Cannot send verification email: scheduler not available',
    );
    await scheduler.runAfter(0, internal.emails.sendVerificationEmailMutation, {
      user: normalizeEmailUser(user),
      url: resolveAuthEmailUrl(url, request),
      token,
    });
  };
}
