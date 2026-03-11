import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppRouter } from '~/router';

vi.mock('../routes/__root', async () => {
  const { Outlet, createRootRoute } = await import('@tanstack/react-router');

  return {
    Route: createRootRoute({
      component: () => <Outlet />,
    }),
  };
});

vi.mock('~/lib/sentry', () => ({
  initializeSentry: vi.fn(),
  setSentryServerUser: vi.fn(),
  setSentryUser: vi.fn(),
}));

export function renderAppRoute(initialEntry = '/') {
  const router = createAppRouter({
    history: createMemoryHistory({
      initialEntries: [initialEntry],
    }),
  });

  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}
