import { normalizeAppRedirectTarget } from '../../features/auth/lib/account-setup-routing';
import { STEP_UP_REQUIREMENTS, type StepUpRequirement } from '../shared/auth-policy';
import { getRequiredBetterAuthUrl, shouldUseSecureAuthCookies } from './env.server';

export const STEP_UP_COOKIE_NAME = 'app_step_up';
const STEP_UP_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const STEP_UP_REQUIREMENT_SET = new Set<string>(Object.values(STEP_UP_REQUIREMENTS));

export type PendingStepUpCookie = {
  redirectTo: string;
  requirement: StepUpRequirement;
  startedAt: number;
};

function encodePayload(value: PendingStepUpCookie) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePayload(value: string): PendingStepUpCookie | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const requirement = record.requirement;
    const redirectTo = record.redirectTo;
    const startedAt = record.startedAt;

    if (
      typeof requirement !== 'string' ||
      !STEP_UP_REQUIREMENT_SET.has(requirement) ||
      typeof redirectTo !== 'string' ||
      typeof startedAt !== 'number'
    ) {
      return null;
    }

    return {
      redirectTo: normalizeAppRedirectTarget(redirectTo),
      requirement: requirement as StepUpRequirement,
      startedAt,
    };
  } catch {
    return null;
  }
}

function getCookieAttributes() {
  const secure = shouldUseSecureAuthCookies(getRequiredBetterAuthUrl());

  return [
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${STEP_UP_COOKIE_MAX_AGE_SECONDS}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function createPendingStepUpCookie(input: {
  redirectTo?: string;
  requirement: StepUpRequirement;
}) {
  const payload = encodePayload({
    redirectTo: normalizeAppRedirectTarget(input.redirectTo),
    requirement: input.requirement,
    startedAt: Date.now(),
  });

  return `${STEP_UP_COOKIE_NAME}=${payload}; ${getCookieAttributes()}`;
}

export function clearPendingStepUpCookie() {
  const secure = shouldUseSecureAuthCookies(getRequiredBetterAuthUrl());
  return [
    `${STEP_UP_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function parsePendingStepUpCookie(cookieHeader: string | null | undefined) {
  if (!cookieHeader) {
    return null;
  }

  const cookiePair = cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith(`${STEP_UP_COOKIE_NAME}=`));

  if (!cookiePair) {
    return null;
  }

  return decodePayload(cookiePair.slice(STEP_UP_COOKIE_NAME.length + 1));
}
