import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { LogOut, Menu, Shield, User } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '~/components/ui/sheet';
import { signOut } from '~/features/auth/auth-client';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { cn } from '~/lib/utils';

export function MobileNavigation() {
  const { user, isAuthenticated, isAdmin, isPending: isLoading } = useAuth();
  const session = { user: isAuthenticated ? user : null };
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { to: '/', label: 'Dashboard', exact: true },
    { to: '/applications', label: 'Applications' },
  ];

  const handleLinkClick = () => {
    setOpen(false);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      handleLinkClick(); // Close the mobile menu
      // Navigate to login page after successful sign out
      navigate({ to: '/login', search: { reset: '', redirect: location.pathname } });
    } catch (error) {
      console.error('Error signing out:', error);
      handleLinkClick(); // Close the mobile menu
      // Still navigate to login even if there's an error
      navigate({ to: '/login', search: { reset: '', redirect: location.pathname } });
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
          aria-label="Open navigation menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[300px] sm:w-[400px]">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
            >
              <img
                src="/android-chrome-192x192.png"
                alt="TanStack Start Template Logo"
                className="w-8 h-8 rounded hover:opacity-80 transition-opacity"
              />
            </Link>
            <SheetTitle>TanStack Start Template</SheetTitle>
          </div>
        </SheetHeader>
        <div className="flex flex-col mx-2">
          {/* Main Navigation */}
          <nav className="flex flex-col space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={handleLinkClick}
                className={cn(
                  'text-foreground hover:text-foreground hover:bg-accent px-3 py-2 rounded-md text-sm font-medium transition-colors',
                )}
                activeOptions={item.exact ? { exact: true } : undefined}
                activeProps={{
                  className: 'bg-accent text-accent-foreground border-l-4 border-primary',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Divider */}
          <div className="border-t border-border my-4" />

          {/* User Actions */}
          <div className="flex flex-col space-y-2">
            {isLoading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
            ) : session?.user ? (
              <div className="space-y-2">
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={handleLinkClick}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    <Shield className="h-4 w-4" />
                    Admin
                  </Link>
                )}
                <Link
                  to="/profile"
                  onClick={handleLinkClick}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                >
                  <User className="h-4 w-4" />
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Link
                  to="/login"
                  search={{ reset: '', redirect: location.pathname }}
                  onClick={handleLinkClick}
                  className="block w-full px-3 py-2 text-sm text-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  onClick={handleLinkClick}
                  className="block w-full px-3 py-2 text-sm text-center bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
