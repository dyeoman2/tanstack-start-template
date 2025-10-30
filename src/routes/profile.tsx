import { createFileRoute } from '@tanstack/react-router';
import { routeAuthGuard } from '~/features/auth/server/route-guards';
import { ProfilePage } from '~/features/profile/components/ProfilePage';
import { getCurrentUserProfileServerFn } from '~/features/profile/server/profile.server';

export const Route = createFileRoute('/profile')({
  beforeLoad: routeAuthGuard,
  loader: () => getCurrentUserProfileServerFn(),
  component: ProfileRouteComponent,
});

function ProfileRouteComponent() {
  const initialProfile = Route.useLoaderData();

  return <ProfilePage initialProfile={initialProfile} />;
}
