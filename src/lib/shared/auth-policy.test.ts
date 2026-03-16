import { describe, expect, it } from 'vitest';
import {
  evaluateFreshSession,
  STEP_UP_REQUIREMENTS,
} from '~/lib/shared/auth-policy';

describe('evaluateFreshSession', () => {
  const now = new Date('2026-03-16T20:00:00.000Z').getTime();
  const windowMs = 15 * 60 * 1000;

  it('uses createdAt when updatedAt is missing', () => {
    const createdAt = now - 5 * 60 * 1000;

    expect(
      evaluateFreshSession({
        createdAt,
        now,
        recentStepUpWindowMs: windowMs,
        requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
      }),
    ).toMatchObject({
      requirement: STEP_UP_REQUIREMENTS.organizationAdmin,
      required: true,
      satisfied: true,
      verifiedAt: createdAt,
      validUntil: createdAt + windowMs,
    });
  });

  it('prefers updatedAt over createdAt when present', () => {
    const createdAt = now - 30 * 60 * 1000;
    const updatedAt = now - 2 * 60 * 1000;

    expect(
      evaluateFreshSession({
        createdAt,
        updatedAt,
        now,
        recentStepUpWindowMs: windowMs,
      }),
    ).toMatchObject({
      satisfied: true,
      verifiedAt: updatedAt,
      validUntil: updatedAt + windowMs,
    });
  });

  it('marks stale sessions as not satisfied', () => {
    const updatedAt = now - 30 * 60 * 1000;

    expect(
      evaluateFreshSession({
        createdAt: updatedAt,
        updatedAt,
        now,
        recentStepUpWindowMs: windowMs,
      }),
    ).toMatchObject({
      satisfied: false,
      verifiedAt: updatedAt,
      validUntil: updatedAt + windowMs,
    });
  });

  it('fails closed for invalid timestamps', () => {
    expect(
      evaluateFreshSession({
        createdAt: 'not-a-date',
        updatedAt: undefined,
        now,
        recentStepUpWindowMs: windowMs,
      }),
    ).toMatchObject({
      satisfied: false,
      verifiedAt: null,
      validUntil: null,
    });
  });

  it('fails closed for missing timestamps', () => {
    expect(
      evaluateFreshSession({
        createdAt: null,
        updatedAt: null,
        now,
        recentStepUpWindowMs: windowMs,
      }),
    ).toMatchObject({
      satisfied: false,
      verifiedAt: null,
      validUntil: null,
    });
  });
});
