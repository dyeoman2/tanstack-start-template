import { createFileRoute } from '@tanstack/react-router';
import { ProfilePage } from '~/features/profile/components/ProfilePage';

export const Route = createFileRoute('/app/profile')({
  staleTime: 30_000,
  gcTime: 2 * 60_000,
  component: ProfileRouteComponent,
});

function ProfileRouteComponent() {
  return <ProfilePage />;
}
