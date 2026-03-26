import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ProfilePage } from '~/features/profile/components/ProfilePage';

export const Route = createFileRoute('/app/profile')({
  staleTime: 30_000,
  gcTime: 2 * 60_000,
  validateSearch: z.object({
    challengeId: z.string().uuid().optional(),
    security: z.enum(['mfa-required', 'step-up-required']).optional(),
  }),
  component: ProfileRouteComponent,
});

function ProfileRouteComponent() {
  return <ProfilePage searchParams={Route.useSearch()} />;
}
