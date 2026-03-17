import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ProfilePage } from '~/features/profile/components/ProfilePage';
import { STEP_UP_REQUIREMENTS } from '~/lib/shared/auth-policy';

export const Route = createFileRoute('/app/profile')({
  staleTime: 30_000,
  gcTime: 2 * 60_000,
  validateSearch: z.object({
    requirement: z.enum([
      STEP_UP_REQUIREMENTS.accountEmailChange,
      STEP_UP_REQUIREMENTS.auditExport,
      STEP_UP_REQUIREMENTS.attachmentAccess,
      STEP_UP_REQUIREMENTS.documentExport,
      STEP_UP_REQUIREMENTS.documentDeletion,
      STEP_UP_REQUIREMENTS.organizationAdmin,
      STEP_UP_REQUIREMENTS.sessionAdministration,
      STEP_UP_REQUIREMENTS.userAdministration,
    ]).optional(),
    security: z.enum(['mfa-required', 'step-up-required']).optional(),
  }),
  component: ProfileRouteComponent,
});

function ProfileRouteComponent() {
  return <ProfilePage searchParams={Route.useSearch()} />;
}
