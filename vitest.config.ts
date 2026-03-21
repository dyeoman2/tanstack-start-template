import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

function createVitestPlugins() {
  return [tanstackRouter({ target: 'react' }), react()];
}

const sharedTestConfig = {
  clearMocks: true,
  restoreMocks: true,
  mockReset: true,
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: 'unit-node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'convex/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['src/lib/roleRefresh.test.ts', 'scripts/script-cli-smoke.test.ts'],
          ...sharedTestConfig,
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: 'unit-cli-smoke',
          environment: 'node',
          include: ['scripts/script-cli-smoke.test.ts'],
          ...sharedTestConfig,
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        plugins: createVitestPlugins(),
        test: {
          name: 'unit-jsdom',
          environment: 'jsdom',
          environmentOptions: {
            jsdom: {
              url: 'http://localhost:3000/',
            },
          },
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx', 'src/lib/roleRefresh.test.ts'],
          ...sharedTestConfig,
        },
      },
    ],
  },
});
