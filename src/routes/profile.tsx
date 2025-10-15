import { createFileRoute } from '@tanstack/react-router';
import { routeAuthGuard } from '~/features/auth/server/route-guards';
import { ProfilePage } from '~/features/profile/components/ProfilePage';

export const Route = createFileRoute('/profile')({
  beforeLoad: routeAuthGuard,
  component: ProfilePage,
});
