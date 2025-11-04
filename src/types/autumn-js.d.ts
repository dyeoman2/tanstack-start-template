declare module 'autumn-js/dist/libraries/react/AutumnContext.mjs' {
  import type { Context } from 'react';

  export interface AutumnContextParams {
    initialized: boolean;
    disableDialogs?: boolean;
    client: Record<string, unknown>;
    paywallDialog: {
      props: unknown;
      setProps: (props: unknown) => void;
      open: boolean;
      setOpen: (open: boolean) => void;
      setComponent: (component: unknown) => void;
    };
    attachDialog: {
      props: unknown;
      setProps: (props: unknown) => void;
      open: boolean;
      setOpen: (open: boolean) => void;
      setComponent: (component: unknown) => void;
    };
    paywallRef: { current: unknown };
    refresh?: number;
    setRefresh?: (value: number) => void;
  }

  export const AutumnContext: Context<AutumnContextParams>;
}
