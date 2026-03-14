import convexPlugin from '@convex-dev/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';

const convexRecommended = convexPlugin.configs.recommended.map((config) => ({
  ...config,
  files: ['convex/**/*.ts', 'convex/**/*.tsx'],
  languageOptions: {
    ...config.languageOptions,
    parser: tsParser,
    sourceType: 'module',
    ecmaVersion: 'latest',
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
}));

export default defineConfig([
  {
    ignores: ['convex/_generated/**', 'convex/betterAuth/_generated/**'],
  },
  ...convexRecommended,
]);
