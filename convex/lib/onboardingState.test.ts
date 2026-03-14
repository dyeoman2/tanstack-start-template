import { describe, expect, it } from 'vitest';
import { buildPersistedOnboardingState } from './onboardingState';

describe('buildPersistedOnboardingState', () => {
  it('clears onboarding email identifiers when the patch sets them to null', () => {
    expect(
      buildPersistedOnboardingState({
        existing: {
          onboardingStatus: 'email_sent',
          onboardingEmailId: 'email_1',
          onboardingEmailMessageId: 'message_1',
          onboardingEmailLastSentAt: 10,
          onboardingDeliveryUpdatedAt: 11,
          onboardingDeliveryError: null,
        },
        patch: {
          onboardingEmailId: null,
          onboardingEmailMessageId: null,
        },
        defaultStatus: 'not_started',
      }),
    ).toEqual({
      onboardingStatus: 'email_sent',
      onboardingEmailId: undefined,
      onboardingEmailMessageId: undefined,
      onboardingEmailLastSentAt: 10,
      onboardingCompletedAt: undefined,
      onboardingDeliveryUpdatedAt: 11,
      onboardingDeliveryError: null,
    });
  });

  it('keeps existing onboarding email identifiers when the patch omits them', () => {
    expect(
      buildPersistedOnboardingState({
        existing: {
          onboardingStatus: 'email_sent',
          onboardingEmailId: 'email_1',
          onboardingEmailMessageId: 'message_1',
          onboardingEmailLastSentAt: 10,
          onboardingDeliveryUpdatedAt: 11,
          onboardingDeliveryError: null,
        },
        patch: {
          onboardingStatus: 'delivery_delayed',
        },
        defaultStatus: 'not_started',
      }),
    ).toEqual({
      onboardingStatus: 'delivery_delayed',
      onboardingEmailId: 'email_1',
      onboardingEmailMessageId: 'message_1',
      onboardingEmailLastSentAt: 10,
      onboardingCompletedAt: undefined,
      onboardingDeliveryUpdatedAt: 11,
      onboardingDeliveryError: null,
    });
  });
});
