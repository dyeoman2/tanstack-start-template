export function buildPersistedOnboardingState<TStatus extends string>(args: {
  existing?: {
    onboardingStatus?: TStatus;
    onboardingEmailId?: string;
    onboardingEmailMessageId?: string;
    onboardingEmailLastSentAt?: number;
    onboardingCompletedAt?: number;
    onboardingDeliveryUpdatedAt?: number;
    onboardingDeliveryError?: string | null;
  } | null;
  patch?: {
    onboardingStatus?: TStatus;
    onboardingEmailId?: string | null;
    onboardingEmailMessageId?: string | null;
    onboardingEmailLastSentAt?: number;
    onboardingCompletedAt?: number;
    onboardingDeliveryUpdatedAt?: number;
    onboardingDeliveryError?: string | null;
  };
  defaultStatus: TStatus;
}) {
  const resolveOptionalString = (
    next: string | null | undefined,
    current: string | undefined,
  ): string | undefined => {
    if (next === undefined) {
      return current;
    }

    return next ?? undefined;
  };

  const resolveOptionalNumber = (
    next: number | undefined,
    current: number | undefined,
  ): number | undefined => {
    if (next === undefined) {
      return current;
    }

    return next;
  };

  const resolveNullableString = (
    next: string | null | undefined,
    current: string | null | undefined,
  ): string | null => {
    if (next === undefined) {
      return current ?? null;
    }

    return next;
  };

  return {
    onboardingStatus:
      args.patch?.onboardingStatus ?? args.existing?.onboardingStatus ?? args.defaultStatus,
    onboardingEmailId: resolveOptionalString(
      args.patch?.onboardingEmailId,
      args.existing?.onboardingEmailId,
    ),
    onboardingEmailMessageId: resolveOptionalString(
      args.patch?.onboardingEmailMessageId,
      args.existing?.onboardingEmailMessageId,
    ),
    onboardingEmailLastSentAt: resolveOptionalNumber(
      args.patch?.onboardingEmailLastSentAt,
      args.existing?.onboardingEmailLastSentAt,
    ),
    onboardingCompletedAt: resolveOptionalNumber(
      args.patch?.onboardingCompletedAt,
      args.existing?.onboardingCompletedAt,
    ),
    onboardingDeliveryUpdatedAt: resolveOptionalNumber(
      args.patch?.onboardingDeliveryUpdatedAt,
      args.existing?.onboardingDeliveryUpdatedAt,
    ),
    onboardingDeliveryError: resolveNullableString(
      args.patch?.onboardingDeliveryError,
      args.existing?.onboardingDeliveryError,
    ),
  };
}
