/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly MODE: string;
  // Remove APP_NAME (only used server-side)
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_CONVEX_SITE_URL?: string;
  // Add missing client-side environment variables
  readonly VITE_AUTUMN_AI_PRODUCT_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: {
    readonly accept: (cb?: () => void) => void;
    readonly dispose: (cb: () => void) => void;
    readonly decline: () => void;
    readonly invalidate: () => void;
    readonly data: Record<string, unknown>;
  };
}
