import { createFileRoute } from '@tanstack/react-router';
import { ProfilePage } from '~/features/profile/components/ProfilePage';
import { getCurrentUserProfileServerFn } from '~/features/profile/server/profile.server';

export const Route = createFileRoute('/app/profile')({
  loader: () => getCurrentUserProfileServerFn(),
  component: ProfileRouteComponent,
});

function ProfileRouteComponent() {
  const initialProfile = Route.useLoaderData();

  return <ProfilePage initialProfile={initialProfile} />;
}
