// Polyfills for Node.js built-ins
import netlify from '@netlify/vite-plugin-tanstack-start';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

export default defineConfig((env) => {
  const isDev = env.mode === 'development';

  return {
    optimizeDeps: {
      exclude: ['fsevents'],
      include: ['@tanstack/router-core', '@tanstack/router-core/ssr/client'],
    },
    resolve: {
      tsconfigPaths: true,
    },
    server: {
      port: 3000,
      host: true,
      watch: {
        // This prevents routeTree writes from triggering full reloads
        ignored: ['**/routeTree.gen.ts'],
      },
    },
    define: {
      global: 'globalThis',
    },
    plugins: [
      tailwindcss(),
      // TanStack Router plugin (via Start) must run before React
      tanstackStart(),
      react(),
      // Adapter after Start + React - only in production builds
      ...(isDev ? [] : [netlify()]),
      visualizer({
        filename: 'dist/stats.html',
        open: false,
        gzipSize: true,
      }),
    ],
  };
});
