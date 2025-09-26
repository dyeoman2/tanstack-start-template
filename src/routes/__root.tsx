import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import { AppShell } from '~/components/AppShell';
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary';
import { NotFound } from '~/components/NotFound';
import { getCurrentUserServerFn } from '~/features/auth/server/auth-checks';
import { seo } from '~/lib/seo';
import type { RouterAuthContext } from '~/router';
import appCss from '~/styles/app.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      ...seo({
        title: 'TanStack Start Template',
        description:
          'TanStack Start template built with Better Auth, Drizzle, Tailwind CSS, Shadcn/UI, Resend, Neon Postgres, and deployed to Netlify',
      }),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
    scripts: [],
  }),
  // Auth check for protected routes only - provides RouterAuthContext to children
  loader: async ({ location }): Promise<RouterAuthContext> => {
    // For public routes, don't fetch auth
    const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password'];
    const isPublicRoute = publicRoutes.some(
      (route) => location.pathname === route || location.pathname.startsWith('/reset-password'),
    );

    if (isPublicRoute) {
      return { user: null, authenticated: false };
    }

    // For protected routes, fetch auth data
    try {
      return await getCurrentUserServerFn();
    } catch (_error) {
      return { user: null, authenticated: false };
    }
  },
  // Router context uses loader data
  context: ({
    context,
    loaderData,
  }: {
    context: RouterAuthContext;
    loaderData?: RouterAuthContext;
  }) => (loaderData ?? context) as RouterAuthContext,
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  component: RootDocument,
});

// Root document component that renders the full HTML structure
function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppShell />
        <Scripts />
      </body>
    </html>
  );
}
