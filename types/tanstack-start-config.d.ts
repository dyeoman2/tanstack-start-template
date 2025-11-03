declare module '@tanstack/react-start/config' {
  interface StartConfig {
    ssr?: boolean;
  }

  export function defineConfig(config: StartConfig): StartConfig;
}
