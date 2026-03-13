export const ONBOARDING_STATUSES = [
  'not_started',
  'email_pending',
  'email_sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'completed',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const RETRYABLE_ONBOARDING_STATUSES: ReadonlySet<OnboardingStatus> = new Set([
  'email_pending',
  'email_sent',
  'delivery_delayed',
  'bounced',
]);

export function getOnboardingStatusLabel(status: OnboardingStatus) {
  switch (status) {
    case 'email_pending':
      return 'Email pending';
    case 'email_sent':
      return 'Email sent';
    case 'delivered':
      return 'Delivered';
    case 'delivery_delayed':
      return 'Delivery delayed';
    case 'bounced':
      return 'Bounced';
    case 'completed':
      return 'Completed';
    default:
      return 'Not started';
  }
}

export function isRetryableOnboardingStatus(status: OnboardingStatus) {
  return RETRYABLE_ONBOARDING_STATUSES.has(status);
}
