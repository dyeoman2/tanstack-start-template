import type { OnboardingStatus } from '../../lib/shared/onboarding';
import type { UserRole } from '../auth/types';

/**
 * Admin feature types
 * Matches Convex query return types
 */

/**
 * User type matching the admin user listing payload
 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  onboardingStatus: OnboardingStatus;
  onboardingEmailId?: string;
  onboardingEmailMessageId?: string;
  onboardingEmailLastSentAt?: number;
  onboardingCompletedAt?: number;
  onboardingDeliveryUpdatedAt?: number;
  onboardingDeliveryError: string | null;
  createdAt: number; // Unix timestamp from Convex
  updatedAt: number; // Unix timestamp from Convex
  organizations?: Array<{
    id: string;
    slug: string;
    name: string;
    logo: string | null;
  }>;
}
