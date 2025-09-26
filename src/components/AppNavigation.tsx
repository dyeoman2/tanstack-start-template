import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useRouter } from '@tanstack/react-router';
import { MobileNavigation } from '~/components/MobileNavigation';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '~/components/ui/navigation-menu';
import { signOut } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { queryInvalidators } from '~/lib/query-keys';
import { cn } from '~/lib/utils';

/**
 * Admin Settings Link - Only renders for admin users
 */
function AdminSettingsLink() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return null;
  }

  return (
    <li>
      <NavigationMenuLink asChild>
        <Link
          to="/admin"
          search={{ showTruncate: false }}
          className="block text-sm leading-none px-2 py-1.5 rounded-sm hover:bg-accent text-red-600 hover:text-red-700"
        >
          Admin
        </Link>
      </NavigationMenuLink>
    </li>
  );
}

/**
 * Authentication Navigation - Sign in/out links
 */
function AuthNavigation({ currentPath }: { currentPath: string }) {
  const { isAuthenticated, isPending } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await signOut();
      queryInvalidators.auth.session(queryClient);
      // Invalidate the root route loader which caches auth state
      await router.invalidate();
      navigate({ to: '/login', search: { reset: '', redirect: currentPath } });
    } catch (error) {
      console.error('Error signing out:', error);
      // Still try to invalidate even on error
      await router.invalidate();
      navigate({ to: '/login', search: { reset: '', redirect: currentPath } });
    }
  };

  if (isAuthenticated || isPending) {
    return (
      <div className="flex items-center space-x-4">
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-4">
      <Link
        to="/login"
        search={{ reset: '', redirect: currentPath }}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        Sign in
      </Link>
      <Link
        to="/register"
        className="text-sm bg-indigo-600 text-white px-3 py-2 rounded-md hover:bg-indigo-700"
      >
        Sign up
      </Link>
    </div>
  );
}

/**
 * Main Application Navigation Component
 */
export function AppNavigation() {
  const location = useLocation();

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 overflow-visible">
          {/* Mobile Navigation - Left side */}
          <div className="flex items-center md:hidden">
            <MobileNavigation />
          </div>

          {/* Desktop Navigation - Hidden on mobile */}
          <div className="hidden md:flex items-center space-x-1">
            <Link
              to="/"
              className={cn(navigationMenuTriggerStyle(), 'no-underline')}
              activeOptions={{ exact: true }}
            >
              Dashboard
            </Link>

            {/* Settings Dropdown */}
            <div className="relative">
              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger>Settings</NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid w-[200px] gap-3 p-4">
                        <AdminSettingsLink />
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>
          </div>

          {/* Right side - Auth navigation */}
          <div className="flex items-center space-x-4">
            {/* Hide auth nav on mobile since it's in the mobile menu */}
            <div className="hidden md:block">
              <AuthNavigation currentPath={location.pathname} />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
