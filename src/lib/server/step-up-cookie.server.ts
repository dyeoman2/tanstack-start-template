import { getRequiredBetterAuthUrl, shouldUseSecureAuthCookies } from './env.server';

export const STEP_UP_COOKIE_NAME = 'app_step_up';
const STEP_UP_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const STEP_UP_CHALLENGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingStepUpCookie = {
  challengeId: string;
};

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

function readCookieValue(cookieHeader: string | null | undefined) {
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

  return cookiePair.slice(STEP_UP_COOKIE_NAME.length + 1);
}

export function createPendingStepUpCookie(input: PendingStepUpCookie) {
  return `${STEP_UP_COOKIE_NAME}=${input.challengeId}; ${getCookieAttributes()}`;
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

export function hasPendingStepUpCookie(cookieHeader: string | null | undefined) {
  return readCookieValue(cookieHeader) !== null;
}

export function parsePendingStepUpCookie(cookieHeader: string | null | undefined) {
  const value = readCookieValue(cookieHeader);
  if (!value || !STEP_UP_CHALLENGE_ID_PATTERN.test(value)) {
    return null;
  }

  return { challengeId: value } satisfies PendingStepUpCookie;
}
