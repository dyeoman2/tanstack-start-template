import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

type TestRouteComponent = () => ReactNode;

interface AdditionalTestRoute {
  path: string;
  component?: TestRouteComponent;
}

interface RenderWithRouterOptions {
  additionalRoutes?: AdditionalTestRoute[];
  initialEntries?: string[];
  path?: string;
}

export function renderWithRouter(
  ui: ReactNode,
  { additionalRoutes = [], initialEntries = ['/'], path = '/' }: RenderWithRouterOptions = {},
) {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });

  const testRoute = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <>{ui}</>,
  });

  const routeTree = rootRoute.addChildren([
    testRoute,
    ...additionalRoutes.map(({ path: additionalPath, component: AdditionalComponent }) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: additionalPath,
        component: AdditionalComponent ?? (() => null),
      }),
    ),
  ]);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries }),
  });

  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}
