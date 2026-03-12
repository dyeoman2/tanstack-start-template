import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

interface AuthRouteShellProps {
  children: ReactNode;
  supplemental?: ReactNode;
}

export function AuthRouteShell({ children, supplemental }: AuthRouteShellProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Link
            to="/"
            className="rounded focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <img
              src="/android-chrome-192x192.png"
              alt="TanStack Start Template Logo"
              className="h-12 w-12 rounded transition-opacity hover:opacity-80"
            />
          </Link>
        </div>

        {supplemental}

        <div className="flex justify-center">{children}</div>
      </div>
    </div>
  );
}
