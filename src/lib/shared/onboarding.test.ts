import { describe, expect, it } from 'vitest';
import { getOnboardingStatusLabel, isRetryableOnboardingStatus } from './onboarding';

describe('getOnboardingStatusLabel', () => {
  it('renders compact admin-facing labels', () => {
    expect(getOnboardingStatusLabel('email_pending')).toBe('Email pending');
    expect(getOnboardingStatusLabel('delivery_delayed')).toBe('Delivery delayed');
    expect(getOnboardingStatusLabel('completed')).toBe('Completed');
  });
});

describe('isRetryableOnboardingStatus', () => {
  it('allows resend for incomplete delivery states', () => {
    expect(isRetryableOnboardingStatus('email_pending')).toBe(true);
    expect(isRetryableOnboardingStatus('email_sent')).toBe(true);
    expect(isRetryableOnboardingStatus('delivery_delayed')).toBe(true);
    expect(isRetryableOnboardingStatus('bounced')).toBe(true);
  });

  it('blocks resend once onboarding is completed', () => {
    expect(isRetryableOnboardingStatus('completed')).toBe(false);
    expect(isRetryableOnboardingStatus('not_started')).toBe(false);
  });
});
