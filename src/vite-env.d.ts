/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly MODE: string;
  readonly APP_NAME?: string;
  readonly VITE_API_URL?: string;
  readonly DATABASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
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
