import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ProfilePage } from '~/features/profile/components/ProfilePage';
import { STEP_UP_REQUIREMENTS } from '~/lib/shared/auth-policy';

export const Route = createFileRoute('/app/profile')({
  staleTime: 30_000,
  gcTime: 2 * 60_000,
  validateSearch: z.object({
    requirement: z.enum([STEP_UP_REQUIREMENTS.accountEmailChange]).optional(),
    security: z.enum(['step-up-required']).optional(),
  }),
  component: ProfileRouteComponent,
});

function ProfileRouteComponent() {
  return <ProfilePage searchParams={Route.useSearch()} />;
}
